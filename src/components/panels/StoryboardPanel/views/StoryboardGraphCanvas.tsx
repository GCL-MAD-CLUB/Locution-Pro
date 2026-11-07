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
  storyboardGraphViewport,
  zoomStoryboardGraphAt,
  type StoryboardGraphCamera,
} from "../../../../core/editor/storyboardGraphLayout";
import type { PanelRowSource } from "../../../../core/editor/multiSource";
import { frameToTimeUs } from "../../../../core/editor/timeline";
import { usePanelActive } from "../../../../runtime/systems/PanelState";
import type { StoryboardShot } from "../../../../types";
import { StoryboardSemanticThumbnail } from "./StoryboardShotThumbnail";
import "./StoryboardGraphView.css";

export interface StoryboardGraphCanvasProps {
  graph?: StoryboardGraph;
  shots: readonly StoryboardShot[];
  sourceForShot: (shot: StoryboardShot) => PanelRowSource;
  shotTitle: (shot: StoryboardShot) => string;
  selectedShotIds: ReadonlySet<string>;
  onSelectShot: (event: MouseEvent<HTMLElement>, shot: StoryboardShot) => void;
  children?: ReactNode;
}

const previewResolution = { width: 640, height: 360 } as const;
const previewMaxWidth = 128;
const previewTipGap = 2;
const previewArrowHeight = 5;
const previewFrameGap = 3;
const graphDotHoverScale = 1.35;
const graphHoverMinPixelsPerWorldUnit = 0.2;
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

export function StoryboardGraphCanvas({
  graph,
  shots,
  sourceForShot,
  shotTitle,
  selectedShotIds,
  onSelectShot,
  children,
}: StoryboardGraphCanvasProps) {
  const panelActive = usePanelActive();
  const stageRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<SVGSVGElement>(null);
  const previewId = useId();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<"canvas" | "overview" | null>(null);
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
  const previewWidth = Math.max(
    1,
    Math.min(previewMaxWidth, size.width - 16, ((size.height - 48) * 16) / 9),
  );
  const previewHeight = (previewWidth * 9) / 16;
  const previews = useMemo<StoryboardGraphPreview[]>(() => {
    if (!hoveredNode || !neighborhood.size) return [];
    const candidates = visibleNodes
      .filter((node) => neighborhood.has(node.id))
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
            distance: Math.hypot(node.x - hoveredNode.x, node.y - hoveredNode.y),
          },
        ];
      })
      .sort((a, b) => b.distance - a.distance);
    return candidates.map((candidate, index) => {
      const point = storyboardGraphScreenPoint(candidate.node, camera, size);
      const dotScale = candidate.node.id === hoveredNode.id ? graphDotHoverScale : 1;
      const previewDistance =
        candidate.node.radius * dotScale * camera.zoom +
        previewTipGap +
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
    hoveredNode,
    neighborhood,
    visibleNodes,
    shotsById,
    sourceForShot,
    camera,
    size,
    previewWidth,
    previewHeight,
  ]);

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
    setHoveredId(null);
    panRef.current = null;
    overviewDragRef.current = null;
    setDragging(null);
  }, [graph, shots]);

  useEffect(() => {
    if (!hoverEnabled) setHoveredId(null);
  }, [hoverEnabled]);

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
      setHoveredId(null);
      updateCamera((current) => zoomStoryboardGraphAt(current, point, factor, size, canvas));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [canvas, size, updateCamera, overviewWorldPoint]);

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (!graph || !event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    if (
      event.target instanceof Element &&
      event.target.closest("button, .storyboard-graph-minimap")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: cameraRef.current,
    };
    setHoveredId(null);
    setDragging("canvas");
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const drag = panRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();
    updateCamera(() =>
      panStoryboardGraph(drag.camera, event.clientX - drag.x, event.clientY - drag.y, size, canvas),
    );
  }

  function stopPan(event: PointerEvent<HTMLDivElement>) {
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
    setHoveredId(null);
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
    setHoveredId(null);
    if (direction)
      updateCamera((current) =>
        panStoryboardGraph(current, direction[0], direction[1], size, canvas),
      );
    else if (event.key === "0") updateCamera(() => initialCamera);
    else
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
      className={`storyboard-graph-view ${hoveredNode ? "has-focus" : ""} ${dragging === "canvas" ? "is-panning" : ""}`}
      style={{ "--storyboard-graph-dot-hover-scale": `${graphDotHoverScale}` } as CSSProperties}
      role="region"
      aria-label="分镜语义图谱"
      tabIndex={0}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
      onLostPointerCapture={stopPan}
      onPointerLeave={hoverEnabled ? () => setHoveredId(null) : undefined}
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
                aria-describedby={activeHoveredId === node.id ? previewId : undefined}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={
                  hoverEnabled
                    ? (event) => {
                        if (!event.buttons) setHoveredId(node.id);
                      }
                    : undefined
                }
                onPointerLeave={hoverEnabled ? () => setHoveredId(null) : undefined}
                onFocus={hoverEnabled ? () => setHoveredId(node.id) : undefined}
                onBlur={hoverEnabled ? () => setHoveredId(null) : undefined}
                onClick={(event) => onSelectShot(event, shot)}
              />
            );
          })}
        </div>
      </div>
      {previews.map((preview) => {
        const isHovered = preview.node.id === hoveredNode?.id;
        return (
          <div
            key={preview.node.id}
            id={isHovered ? previewId : undefined}
            role={isHovered ? "tooltip" : undefined}
            aria-hidden={isHovered ? undefined : true}
            className={`storyboard-graph-preview ${preview.above ? "is-above" : "is-below"}${isHovered ? "" : " is-neighbor"}`}
            style={
              {
                width: previewWidth,
                left: preview.left,
                top: preview.top,
                zIndex: preview.zIndex,
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
      {children}
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
        onPointerEnter={() => setHoveredId(null)}
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
