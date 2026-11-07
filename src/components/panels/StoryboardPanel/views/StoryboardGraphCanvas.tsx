import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { StoryboardGraph, StoryboardGraphNode } from "../../../../core/editor/storyboardGraph";
import {
  constrainStoryboardGraphCamera,
  fitStoryboardGraphCamera,
  panStoryboardGraph,
  storyboardGraphCanvas,
  storyboardGraphNeighborhood,
  storyboardGraphOverviewCanvas,
  storyboardGraphOverviewPoint,
  storyboardGraphOverviewWorldPoint,
  storyboardGraphScreenPoint,
  storyboardGraphWorldPoint,
  storyboardGraphViewport,
  zoomStoryboardGraphAt,
  type StoryboardGraphCamera,
  type StoryboardGraphRect,
} from "../../../../core/editor/storyboardGraphLayout";
import {
  applyStoryboardGraphSelection,
  storyboardGraphMarqueeHitIds,
  storyboardGraphSelectionRect,
  storyboardGraphSelectionRing,
  type StoryboardGraphSelectionMode,
  type StoryboardGraphTool,
} from "../../../../core/editor/storyboardGraphSelection";
import type { PanelRowSource } from "../../../../core/editor/multiSource";
import { frameToTimeUs } from "../../../../core/editor/timeline";
import { usePanelActive } from "../../../../runtime/systems/PanelState";
import type { StoryboardShot } from "../../../../types";
import { StoryboardSemanticThumbnail } from "./StoryboardShotThumbnail";
import { StoryboardGraphTools } from "./StoryboardGraphTools";
import "./StoryboardGraphView.css";

export interface StoryboardGraphCanvasProps {
  graph?: StoryboardGraph;
  shots: readonly StoryboardShot[];
  sourceForShot: (shot: StoryboardShot) => PanelRowSource;
  shotTitle: (shot: StoryboardShot) => string;
  selectedShotIds: ReadonlySet<string>;
  onSelectionChange: (shotIds: ReadonlySet<string>) => void;
  onActivateShot: (shot: StoryboardShot) => void;
  children?: ReactNode;
}

const previewResolution = { width: 640, height: 360 } as const;
const previewMaxWidth = 128;
const previewTipGap = 2;
const previewArrowHeight = 5;
const previewFrameGap = 3;
const graphDotHoverScale = 1.35;
const graphHoverMinPixelsPerWorldUnit = 0.4;
const emptyNodes: StoryboardGraph["nodes"] = [];

interface StoryboardGraphPreview {
  node: StoryboardGraphNode;
  source: PanelRowSource;
  above: boolean;
  left: number;
  top: number;
  caret: number;
  priority: number;
  zIndex: number;
}

interface MarqueeGesture {
  id: number;
  start: { x: number; y: number };
  point: { x: number; y: number };
  base: ReadonlySet<string>;
  mode: StoryboardGraphSelectionMode;
  camera: StoryboardGraphCamera;
  capture: HTMLElement;
  active: boolean;
  timer?: number;
}

export function StoryboardGraphCanvas({
  graph,
  shots,
  sourceForShot,
  shotTitle,
  selectedShotIds,
  onSelectionChange,
  onActivateShot,
  children,
}: StoryboardGraphCanvasProps) {
  const panelActive = usePanelActive();
  const stageRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<SVGSVGElement>(null);
  const previewId = useId();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
  const hoverLeaveTimerRef = useRef<number | undefined>(undefined);
  const cancelHoverLeave = useCallback(() => {
    window.clearTimeout(hoverLeaveTimerRef.current);
    hoverLeaveTimerRef.current = undefined;
  }, []);
  const resetHover = useCallback(() => {
    cancelHoverLeave();
    setHoveredId(null);
    setHoveredPreviewId(null);
  }, [cancelHoverLeave]);
  const leaveHover = useCallback(() => {
    cancelHoverLeave();
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      setHoveredId(null);
      setHoveredPreviewId(null);
    }, 180);
  }, [cancelHoverLeave]);
  const [dragging, setDragging] = useState<"canvas" | "overview" | null>(null);
  const [tool, setTool] = useState<StoryboardGraphTool>("pointer");
  const [selectionMode, setSelectionMode] = useState<StoryboardGraphSelectionMode>("replace");
  const [marquee, setMarquee] = useState<StoryboardGraphRect | null>(null);
  const marqueeRef = useRef<MarqueeGesture | null>(null);
  const suppressClickRef = useRef(false);
  const lastClickRef = useRef<{
    id: string;
    base: ReadonlySet<string>;
    mode: StoryboardGraphSelectionMode;
  } | null>(null);
  const selectionRef = useRef(selectedShotIds);
  selectionRef.current = selectedShotIds;
  const callbacksRef = useRef({ onSelectionChange, onActivateShot });
  callbacksRef.current = { onSelectionChange, onActivateShot };
  const commitSelection = useCallback((ids: ReadonlySet<string>) => {
    selectionRef.current = ids;
    callbacksRef.current.onSelectionChange(ids);
  }, []);
  const nodes = graph?.nodes ?? emptyNodes;
  const canvas = useMemo(() => storyboardGraphCanvas(nodes), [nodes]);
  const overviewCanvas = useMemo(() => storyboardGraphOverviewCanvas(size, canvas), [size, canvas]);
  const initialCamera = useMemo(
    () => fitStoryboardGraphCamera(nodes, size, canvas),
    [nodes, size, canvas],
  );
  const [navigation, setNavigation] = useState<{
    graph: StoryboardGraph | undefined;
    camera: StoryboardGraphCamera;
  } | null>(null);
  const camera = constrainStoryboardGraphCamera(
    navigation && navigation.graph === graph ? navigation.camera : initialCamera,
    size,
    canvas,
  );
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const hoverEnabled = camera.zoom > graphHoverMinPixelsPerWorldUnit;
  const activeHoveredId = hoverEnabled ? hoveredId : null;
  const panRef = useRef<{ id: number; x: number; y: number; camera: StoryboardGraphCamera } | null>(
    null,
  );
  const overviewDragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const updateCamera = useCallback(
    (update: (current: StoryboardGraphCamera) => StoryboardGraphCamera) => {
      const next = constrainStoryboardGraphCamera(update(cameraRef.current), size, canvas);
      cameraRef.current = next;
      setNavigation({ graph, camera: next });
    },
    [graph, size, canvas],
  );

  const shotsById = useMemo(() => new Map(shots.map((shot) => [shot.id, shot])), [shots]);
  const visibleNodes = useMemo(
    () => nodes.filter((node) => shotsById.has(node.id)),
    [nodes, shotsById],
  );
  const visibleNodeKey = JSON.stringify(visibleNodes.map((node) => node.id));
  const edges = useMemo(
    () =>
      graph?.edges.filter(
        (edge) => shotsById.has(nodes[edge.source].id) && shotsById.has(nodes[edge.target].id),
      ) ?? [],
    [graph, nodes, shotsById],
  );
  const neighborhood = useMemo(
    () =>
      graph && activeHoveredId
        ? storyboardGraphNeighborhood(graph, activeHoveredId)
        : new Set<string>(),
    [graph, activeHoveredId],
  );
  const viewport = storyboardGraphViewport(camera, size);
  const overviewViewport = storyboardGraphOverviewPoint(viewport, overviewCanvas);
  const hoveredNode = activeHoveredId
    ? visibleNodes.find((node) => node.id === activeHoveredId)
    : undefined;
  const previewEmphasis = useMemo(() => {
    if (tool !== "pointer") return null;
    if (hoveredPreviewId) {
      return !selectedShotIds.has(hoveredPreviewId) && graph
        ? storyboardGraphNeighborhood(graph, hoveredPreviewId)
        : new Set([hoveredPreviewId]);
    }
    return activeHoveredId && selectedShotIds.has(activeHoveredId)
      ? new Set([activeHoveredId])
      : null;
  }, [tool, hoveredPreviewId, activeHoveredId, selectedShotIds, graph]);
  const previewWidth = Math.max(
    1,
    Math.min(previewMaxWidth, size.width - 16, ((size.height - 48) * 16) / 9),
  );
  const previewHeight = (previewWidth * 9) / 16;
  const previews = useMemo<StoryboardGraphPreview[]>(() => {
    if (!hoverEnabled) return [];
    const candidates = visibleNodes
      .filter(
        (node) =>
          selectedShotIds.has(node.id) ||
          (tool === "hand" ? neighborhood.has(node.id) : node.id === hoveredNode?.id),
      )
      .flatMap((node) => {
        const shot = shotsById.get(node.id);
        if (!shot) return [];
        const point = storyboardGraphScreenPoint(node, camera, size);
        if (point.x < 0 || point.x > size.width || point.y < 0 || point.y > size.height) {
          return [];
        }
        return [
          {
            node,
            source: sourceForShot(shot),
            distance: Math.hypot(
              node.x - (hoveredNode?.x ?? camera.x),
              node.y - (hoveredNode?.y ?? camera.y),
            ),
          },
        ];
      })
      .sort((a, b) => b.distance - a.distance);
    return candidates.map((candidate, index) => {
      const point = storyboardGraphScreenPoint(candidate.node, camera, size);
      const selected = selectedShotIds.has(candidate.node.id);
      const dotScale = !selected && candidate.node.id === hoveredNode?.id ? graphDotHoverScale : 1;
      const previewDistance =
        candidate.node.radius * dotScale * camera.zoom +
        previewTipGap +
        (selected ? storyboardGraphSelectionRing(candidate.node.radius, camera.zoom).gap + 1 : 0) +
        previewArrowHeight +
        previewFrameGap;
      const topAbove = point.y - previewDistance - previewHeight;
      const topBelow = point.y + previewDistance;
      const spaceAbove = topAbove - 8;
      const spaceBelow = size.height - 8 - (topBelow + previewHeight);
      const above = spaceAbove >= 0 || spaceAbove >= spaceBelow;
      const left = Math.max(8, Math.min(size.width - previewWidth - 8, point.x - previewWidth / 2));
      return {
        node: candidate.node,
        source: candidate.source,
        above,
        left,
        top: above
          ? Math.max(8, topAbove)
          : Math.max(8, Math.min(size.height - previewHeight - 8, topBelow)),
        caret: Math.max(8, Math.min(previewWidth - 8, point.x - left)),
        priority: candidates.length - 1 - index,
        zIndex: 4 + index,
      };
    });
  }, [
    hoverEnabled,
    hoveredNode,
    tool,
    neighborhood,
    selectedShotIds,
    visibleNodes,
    shotsById,
    sourceForShot,
    camera,
    size,
    previewWidth,
    previewHeight,
  ]);

  const cancelGestures = useCallback(
    (restoreSelection = true) => {
      const selection = marqueeRef.current;
      const pan = panRef.current;
      const overview = overviewDragRef.current;
      marqueeRef.current = null;
      panRef.current = null;
      overviewDragRef.current = null;
      if (selection) {
        window.clearTimeout(selection.timer);
        if (selection.capture.hasPointerCapture(selection.id))
          selection.capture.releasePointerCapture(selection.id);
        if (selection.active && restoreSelection) commitSelection(selection.base);
      }
      if (pan && stageRef.current?.hasPointerCapture(pan.id))
        stageRef.current.releasePointerCapture(pan.id);
      if (overview && overviewRef.current?.hasPointerCapture(overview.id))
        overviewRef.current.releasePointerCapture(overview.id);
      setMarquee(null);
      setDragging(null);
    },
    [commitSelection],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    resetHover();
    lastClickRef.current = null;
    cancelGestures(false);
  }, [graph, visibleNodeKey, cancelGestures, resetHover]);

  useEffect(() => {
    if (!panelActive) {
      cancelGestures();
      resetHover();
    }
  }, [panelActive, cancelGestures, resetHover]);

  useEffect(() => () => cancelHoverLeave(), [cancelHoverLeave]);

  useEffect(() => {
    const blur = () => {
      cancelGestures();
      resetHover();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        (!marqueeRef.current && !panRef.current && !overviewDragRef.current)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      cancelGestures();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
      const current = marqueeRef.current;
      if (current) window.clearTimeout(current.timer);
    };
  }, [cancelGestures, resetHover]);

  useEffect(() => {
    if (!hoverEnabled) resetHover();
  }, [hoverEnabled, resetHover]);

  const overviewWorldPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const svg = overviewRef.current;
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return storyboardGraphOverviewWorldPoint(
        point.matrixTransform(matrix.inverse()),
        overviewCanvas,
      );
    },
    [overviewCanvas],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      cancelGestures();
      const bounds = stage.getBoundingClientRect();
      let point = {
        x: event.clientX - bounds.left - stage.clientLeft,
        y: event.clientY - bounds.top - stage.clientTop,
      };
      if (event.target instanceof Element && event.target.closest(".storyboard-graph-minimap")) {
        const world = overviewWorldPoint(event);
        if (world) point = storyboardGraphScreenPoint(world, cameraRef.current, size);
      }
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const factor = Math.exp(-Math.max(-600, Math.min(600, delta)) * 0.0015);
      resetHover();
      updateCamera((current) => zoomStoryboardGraphAt(current, point, factor, size, canvas));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [canvas, size, updateCamera, overviewWorldPoint, cancelGestures, resetHover]);

  function canvasPoint(event: { clientX: number; clientY: number }) {
    const stage = stageRef.current!;
    const bounds = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.width, event.clientX - bounds.left - stage.clientLeft)),
      y: Math.max(0, Math.min(size.height, event.clientY - bounds.top - stage.clientTop)),
    };
  }

  function updateMarquee(gesture: MarqueeGesture, point: { x: number; y: number }) {
    gesture.active = true;
    gesture.point = point;
    window.clearTimeout(gesture.timer);
    suppressClickRef.current = true;
    resetHover();
    const rect = storyboardGraphSelectionRect(gesture.start, point);
    setMarquee(rect);
    const start = storyboardGraphWorldPoint(gesture.start, gesture.camera, size);
    const end = storyboardGraphWorldPoint(point, gesture.camera, size);
    const hits = storyboardGraphMarqueeHitIds(
      visibleNodes,
      storyboardGraphSelectionRect(start, end),
    );
    commitSelection(applyStoryboardGraphSelection(gesture.base, hits, gesture.mode));
  }

  function startCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    if (!graph || !event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        ".storyboard-graph-tools, .storyboard-graph-minimap, .storyboard-graph-message",
      )
    )
      return;
    if (tool === "pointer" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
    if (tool === "pointer") {
      const node =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>(".storyboard-graph-dot")
          : null;
      const capture = node ?? event.currentTarget;
      capture.focus({ preventScroll: true });
      capture.setPointerCapture(event.pointerId);
      const gesture: MarqueeGesture = {
        id: event.pointerId,
        start: canvasPoint(event),
        point: canvasPoint(event),
        base: new Set(selectionRef.current),
        mode: selectionMode,
        camera: cameraRef.current,
        capture,
        active: false,
      };
      gesture.timer = window.setTimeout(() => {
        if (marqueeRef.current === gesture) updateMarquee(gesture, gesture.point);
      }, 180);
      marqueeRef.current = gesture;
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: cameraRef.current,
    };
    resetHover();
    setDragging("canvas");
  }

  function moveCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    const selection = marqueeRef.current;
    if (selection?.id === event.pointerId) {
      event.preventDefault();
      const point = canvasPoint(event);
      selection.point = point;
      if (
        selection.active ||
        Math.hypot(point.x - selection.start.x, point.y - selection.start.y) >= 4
      )
        updateMarquee(selection, point);
      return;
    }
    const drag = panRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    updateCamera(() =>
      panStoryboardGraph(drag.camera, event.clientX - drag.x, event.clientY - drag.y, size, canvas),
    );
  }

  function stopCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    const selection = marqueeRef.current;
    if (selection?.id === event.pointerId) {
      if (event.type !== "pointerup") {
        cancelGestures();
        return;
      }
      if (selection.active) updateMarquee(selection, canvasPoint(event));
      marqueeRef.current = null;
      window.clearTimeout(selection.timer);
      setMarquee(null);
      if (selection.capture.hasPointerCapture(selection.id))
        selection.capture.releasePointerCapture(selection.id);
      return;
    }
    if (panRef.current?.id !== event.pointerId) return;
    panRef.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startOverviewDrag(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const point = overviewWorldPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const onFrame =
      event.target instanceof Element && event.target.hasAttribute("data-graph-viewport");
    overviewDragRef.current = {
      id: event.pointerId,
      x: onFrame ? point.x - cameraRef.current.x : 0,
      y: onFrame ? point.y - cameraRef.current.y : 0,
    };
    if (!onFrame) updateCamera((current) => ({ ...current, x: point.x, y: point.y }));
    resetHover();
    setDragging("overview");
  }

  function moveOverviewDrag(event: PointerEvent<SVGSVGElement>) {
    const drag = overviewDragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const point = overviewWorldPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    updateCamera((current) => ({ ...current, x: point.x - drag.x, y: point.y - drag.y }));
  }

  function stopOverviewDrag(event: PointerEvent<SVGSVGElement>) {
    if (overviewDragRef.current?.id !== event.pointerId) return;
    overviewDragRef.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function navigateKeyboard(event: KeyboardEvent<HTMLElement | SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const directions: Record<string, readonly [number, number]> = {
      ArrowLeft: [48, 0],
      ArrowRight: [-48, 0],
      ArrowUp: [0, 48],
      ArrowDown: [0, -48],
    };
    const direction = directions[event.key];
    if (!direction && !["+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    resetHover();
    if (direction && (tool === "hand" || event.currentTarget === overviewRef.current))
      updateCamera((current) =>
        panStoryboardGraph(current, direction[0], direction[1], size, canvas),
      );
    else if (event.key === "0") updateCamera(() => initialCamera);
    else if (!direction)
      updateCamera((current) =>
        zoomStoryboardGraphAt(
          current,
          { x: size.width / 2, y: size.height / 2 },
          event.key === "-" ? 1 / 1.25 : 1.25,
          size,
          canvas,
        ),
      );
  }

  function selectNode(event: MouseEvent<HTMLElement>, shot: StoryboardShot, group: boolean) {
    event.preventDefault();
    event.stopPropagation();
    if (tool !== "pointer" || suppressClickRef.current || (!group && event.detail > 1)) return;
    const previous = lastClickRef.current;
    const base =
      group && previous?.id === shot.id && previous.mode === selectionMode
        ? previous.base
        : new Set(selectionRef.current);
    if (!group) lastClickRef.current = { id: shot.id, base, mode: selectionMode };
    const hits =
      group && graph
        ? new Set(
            [...storyboardGraphNeighborhood(graph, shot.id)].filter((id) => shotsById.has(id)),
          )
        : new Set([shot.id]);
    commitSelection(applyStoryboardGraphSelection(base, hits, selectionMode));
    callbacksRef.current.onActivateShot(shot);
  }

  function changeTool(next: StoryboardGraphTool) {
    cancelGestures();
    resetHover();
    lastClickRef.current = null;
    setTool(next);
  }

  const overviewGeometry = useMemo(
    () => (
      <g className="storyboard-graph-minimap-content" pointerEvents="none">
        {edges.map((edge) => {
          const a = storyboardGraphOverviewPoint(nodes[edge.source], overviewCanvas);
          const b = storyboardGraphOverviewPoint(nodes[edge.target], overviewCanvas);
          return <line key={`${edge.source}:${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {visibleNodes.map((node) => {
          const point = storyboardGraphOverviewPoint(node, overviewCanvas);
          return (
            <circle
              key={node.id}
              cx={point.x}
              cy={point.y}
              r={0.8}
              className={selectedShotIds.has(node.id) ? "is-selected" : ""}
            />
          );
        })}
      </g>
    ),
    [edges, nodes, overviewCanvas, visibleNodes, selectedShotIds],
  );

  return (
    <div
      ref={stageRef}
      className={`storyboard-graph-view is-${tool} ${hoveredNode ? "has-focus" : ""} ${dragging === "canvas" ? "is-panning" : ""} ${marquee ? "is-selecting" : ""}`}
      style={
        {
          "--storyboard-graph-dot-hover-scale": `${graphDotHoverScale}`,
        } as CSSProperties
      }
      role="region"
      aria-label="分镜语义图谱"
      tabIndex={0}
      onPointerDown={startCanvasGesture}
      onPointerMove={moveCanvasGesture}
      onPointerUp={stopCanvasGesture}
      onPointerCancel={stopCanvasGesture}
      onLostPointerCapture={stopCanvasGesture}
      onClickCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(".storyboard-graph-tools, .storyboard-graph-minimap")
        )
          return;
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(
            "button, .storyboard-graph-minimap, .storyboard-graph-tools, .storyboard-graph-message",
          )
        )
          return;
        if (tool === "pointer")
          commitSelection(
            applyStoryboardGraphSelection(selectionRef.current, new Set(), selectionMode),
          );
      }}
      onPointerLeave={resetHover}
      onKeyDown={navigateKeyboard}
    >
      <div
        className="storyboard-graph-world"
        style={{
          transform: `translate(${size.width / 2 - camera.x * camera.zoom}px, ${size.height / 2 - camera.y * camera.zoom}px) scale(${camera.zoom})`,
        }}
      >
        <svg className="storyboard-graph-edges" width={1} height={1} aria-hidden="true">
          {edges.map((edge) => {
            const source = nodes[edge.source];
            const target = nodes[edge.target];
            const highlighted = neighborhood.has(source.id) && neighborhood.has(target.id);
            return (
              <line
                key={`${source.id}:${target.id}`}
                className={highlighted ? "is-highlighted" : hoveredNode ? "is-muted" : ""}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                vectorEffect="non-scaling-stroke"
                opacity={highlighted ? 0.8 : 0.08 + edge.similarity * 0.14}
              />
            );
          })}
        </svg>
        <div className="storyboard-graph-nodes" role="group" aria-label="分镜圆点">
          {visibleNodes.map((node) => {
            const shot = shotsById.get(node.id)!;
            return (
              <button
                type="button"
                key={node.id}
                className={`storyboard-graph-dot ${selectedShotIds.has(node.id) ? "is-selected" : ""} ${activeHoveredId === node.id ? "is-hovered" : ""} ${neighborhood.has(node.id) ? "is-neighbor" : ""}`}
                style={
                  {
                    left: node.x,
                    top: node.y,
                    "--storyboard-graph-dot-size": `${node.radius * 2}px`,
                  } as CSSProperties
                }
                aria-label={shotTitle(shot)}
                aria-pressed={selectedShotIds.has(node.id)}
                tabIndex={tool === "pointer" ? 0 : -1}
                aria-describedby={activeHoveredId === node.id ? previewId : undefined}
                onPointerEnter={
                  hoverEnabled
                    ? (event) => {
                        if (!event.buttons) {
                          cancelHoverLeave();
                          setHoveredPreviewId(null);
                          setHoveredId(node.id);
                        }
                      }
                    : undefined
                }
                onPointerLeave={
                  hoverEnabled ? (tool === "pointer" ? leaveHover : resetHover) : undefined
                }
                onFocus={
                  hoverEnabled
                    ? () => {
                        cancelHoverLeave();
                        setHoveredPreviewId(null);
                        setHoveredId(node.id);
                      }
                    : undefined
                }
                onBlur={hoverEnabled ? resetHover : undefined}
                onClick={(event) => selectNode(event, shot, false)}
                onDoubleClick={(event) => selectNode(event, shot, true)}
              />
            );
          })}
        </div>
      </div>
      <svg
        className="storyboard-graph-selection-rings"
        width={size.width}
        height={size.height}
        aria-hidden="true"
      >
        {visibleNodes
          .filter((node) => selectedShotIds.has(node.id) || node.id === activeHoveredId)
          .sort((a, b) => Number(a.id === activeHoveredId) - Number(b.id === activeHoveredId))
          .map((node) => {
            const point = storyboardGraphScreenPoint(node, camera, size);
            const selected = selectedShotIds.has(node.id);
            const ring = storyboardGraphSelectionRing(node.radius, camera.zoom);
            return (
              <g
                key={node.id}
                data-overlay-node={node.id}
                transform={`translate(${point.x}, ${point.y})`}
              >
                <circle
                  data-selection-node={selected ? node.id : undefined}
                  className={
                    selected ? "storyboard-graph-selected-node" : "storyboard-graph-hovered-node"
                  }
                  r={
                    selected
                      ? node.radius * camera.zoom
                      : (node.radius - 0.5) * camera.zoom * graphDotHoverScale
                  }
                  strokeWidth={selected ? undefined : camera.zoom * graphDotHoverScale}
                />
                {selected && <circle data-selection-ring={node.id} r={ring.radius} />}
              </g>
            );
          })}
      </svg>
      {marquee && (
        <div
          className="storyboard-graph-marquee"
          aria-hidden="true"
          style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
        />
      )}
      <div className="storyboard-graph-previews">
        {previews.map((preview) => {
          const isHovered = preview.node.id === hoveredNode?.id;
          return (
            <div
              key={preview.node.id}
              id={isHovered ? previewId : undefined}
              role={isHovered ? "tooltip" : undefined}
              data-preview-shot-id={preview.node.id}
              className={`storyboard-graph-preview ${preview.above ? "is-above" : "is-below"}${selectedShotIds.has(preview.node.id) ? " is-selected" : ""}${!isHovered && !selectedShotIds.has(preview.node.id) ? " is-neighbor" : ""}${previewEmphasis && !previewEmphasis.has(preview.node.id) ? " is-muted" : ""}`}
              onPointerEnter={
                tool === "pointer"
                  ? () => {
                      cancelHoverLeave();
                      setHoveredPreviewId(preview.node.id);
                    }
                  : undefined
              }
              onPointerLeave={
                tool === "pointer"
                  ? () => {
                      setHoveredPreviewId(null);
                      leaveHover();
                    }
                  : undefined
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              style={
                {
                  width: previewWidth,
                  left: preview.left,
                  top: preview.top,
                  zIndex:
                    preview.node.id === hoveredPreviewId ? previews.length + 4 : preview.zIndex,
                  "--storyboard-graph-preview-caret": `${preview.caret}px`,
                  "--storyboard-graph-preview-arrow-gap": `${previewFrameGap}px`,
                  "--storyboard-graph-preview-arrow-height": `${previewArrowHeight}px`,
                } as CSSProperties
              }
            >
              <StoryboardSemanticThumbnail
                ariaLabel="分镜选帧缩略图"
                assetId={preview.source.assetId}
                fingerprint={preview.source.fingerprint}
                videoPath={preview.source.videoPath}
                frameRate={preview.source.frameRate}
                timeUs={frameToTimeUs(preview.node.thumbnailFrame, preview.source.frameRate)}
                resolution={previewResolution}
                priority={preview.priority}
                requestEnabled={panelActive && Boolean(preview.source.videoPath)}
              />
            </div>
          );
        })}
      </div>
      {children}
      <StoryboardGraphTools
        tool={tool}
        mode={selectionMode}
        onToolChange={changeTool}
        onModeChange={(next) => {
          cancelGestures();
          lastClickRef.current = null;
          setSelectionMode(next);
        }}
      />
      <svg
        ref={overviewRef}
        className={`storyboard-graph-minimap ${dragging === "overview" ? "is-dragging" : ""}`}
        viewBox="0 0 160 90"
        role="group"
        aria-label="图谱全景导航"
        tabIndex={0}
        onPointerDown={startOverviewDrag}
        onPointerMove={moveOverviewDrag}
        onPointerUp={stopOverviewDrag}
        onPointerCancel={stopOverviewDrag}
        onLostPointerCapture={stopOverviewDrag}
        onPointerEnter={resetHover}
        onKeyDown={navigateKeyboard}
      >
        {overviewGeometry}
        <rect
          data-graph-viewport=""
          className="storyboard-graph-minimap-viewport"
          x={overviewViewport.x}
          y={overviewViewport.y}
          width={(viewport.width / overviewCanvas.width) * 160}
          height={(viewport.height / overviewCanvas.height) * 90}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
