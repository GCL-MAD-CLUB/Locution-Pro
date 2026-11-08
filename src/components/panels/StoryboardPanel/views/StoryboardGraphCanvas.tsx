import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type {
  StoryboardGraph,
  StoryboardGraphNode,
} from "../../../../core/editor/storyboardGraph/graph";
import {
  constrainStoryboardGraphCamera,
  fitStoryboardGraphCamera,
  panStoryboardGraph,
  storyboardGraphCanvas,
  indexStoryboardGraphNeighborhoods,
  storyboardGraphOverviewCanvas,
  storyboardGraphOverviewPoint,
  storyboardGraphOverviewWorldPoint,
  storyboardGraphScreenPoint,
  storyboardGraphNodeScale,
  storyboardGraphWorldPoint,
  storyboardGraphViewport,
  zoomStoryboardGraphAt,
  type StoryboardGraphCamera,
  type StoryboardGraphRect,
} from "../../../../core/editor/storyboardGraph/camera";
import {
  applyStoryboardGraphSelection,
  storyboardGraphMarqueeHitIds,
  storyboardGraphSelectionRect,
  storyboardGraphSelectionRing,
  type StoryboardGraphSelectionMode,
  type StoryboardGraphTool,
} from "../../../../core/editor/storyboardGraph/selection";
import type { PanelRowSource } from "../../../../core/editor/multiSource";
import { annotationColors } from "../../../../runtime/theme";
import { usePanelActive } from "../../../../runtime/systems/PanelState";
import type { StoryboardShot, StoryboardShotAnnotation } from "../../../../types";
import { StoryboardGraphThumbnail } from "./StoryboardGraphThumbnail";
import { StoryboardGraphTools } from "./StoryboardGraphTools";
import "./StoryboardGraphView.css";

export interface StoryboardGraphCanvasProps {
  graph?: StoryboardGraph;
  shots: readonly StoryboardShot[];
  sourceForShot: (shot: StoryboardShot) => PanelRowSource;
  shotTitle: (shot: StoryboardShot) => string;
  selectedShotIds: ReadonlySet<string>;
  shotAnnotations?: Readonly<Record<string, StoryboardShotAnnotation>>;
  sprayActive?: boolean;
  onSprayShots?: (
    shotIds: ReadonlySet<string>,
    historyGroupId: string,
    eraseWithAlt: boolean,
  ) => void;
  onExitSpray?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onSelectionChange: (shotIds: ReadonlySet<string>) => void;
  onActivateShot: (shot: StoryboardShot) => void;
  children?: ReactNode;
}

const previewMaxWidth = 128;
const previewTipGap = 2;
const previewArrowHeight = 5;
const previewFrameGap = 3;
const graphDotHoverScale = 1.1;
const graphHoverDurationMs = 120;
const graphHoverMinPixelsPerWorldUnit = 0.35;
const emptyNodes: StoryboardGraph["nodes"] = [];
const emptyAnnotations: Readonly<Record<string, StoryboardShotAnnotation>> = {};
const emptyNeighborhood = new Set<string>();

// Topology changes immediately; positions, radii, hit targets, links and the
// overview move together. Preserve velocity when another filter interrupts.
function useGraphNodeMotion(target: StoryboardGraph["nodes"]) {
  const [painted, setPainted] = useState(target);
  const motion = useRef(
    new Map<string, { x: number; y: number; radius: number; vx: number; vy: number; vr: number }>(),
  );
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const immediate =
      !initialized.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (target.length) initialized.current = true;
    for (const node of target) {
      if (immediate || !motion.current.has(node.id))
        motion.current.set(node.id, { ...node, vx: 0, vy: 0, vr: 0 });
    }
    if (immediate || !target.length) {
      setPainted(target);
      return;
    }
    let frame = 0;
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      const elapsed = Math.min(1 / 30, Math.max(0, (now - previous) / 1000));
      previous = now;
      const steps = Math.max(1, Math.ceil(elapsed * 120));
      const dt = elapsed / steps;
      let settled = true;
      const next = target.map((node) => {
        const current = motion.current.get(node.id)!;
        for (let step = 0; step < steps; step++) {
          current.vx += ((node.x - current.x) * 180 - current.vx * 20) * dt;
          current.vy += ((node.y - current.y) * 180 - current.vy * 20) * dt;
          current.vr += ((node.radius - current.radius) * 180 - current.vr * 20) * dt;
          current.x += current.vx * dt;
          current.y += current.vy * dt;
          current.radius += current.vr * dt;
        }
        if (
          now - started < 1400 &&
          (Math.hypot(node.x - current.x, node.y - current.y, node.radius - current.radius) >
            0.02 ||
            Math.hypot(current.vx, current.vy, current.vr) > 0.1)
        )
          settled = false;
        return { ...node, x: current.x, y: current.y, radius: current.radius };
      });
      if (settled) {
        for (const node of target) motion.current.set(node.id, { ...node, vx: 0, vy: 0, vr: 0 });
        setPainted(target);
      } else {
        setPainted(next);
        frame = requestAnimationFrame(tick);
      }
    };
    // Paint the retained positions before the first animation frame.
    setPainted(
      target.map((node) => {
        const current = motion.current.get(node.id)!;
        return { ...node, x: current.x, y: current.y, radius: current.radius };
      }),
    );
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return useMemo(() => {
    if (painted === target) return target;
    const byId = new Map(painted.map((node) => [node.id, node]));
    return target.map((node) => {
      const previous = byId.get(node.id);
      return previous ? { ...node, x: previous.x, y: previous.y, radius: previous.radius } : node;
    });
  }, [target, painted]);
}

function annotationStyle(
  annotation: StoryboardShotAnnotation | undefined,
): CSSProperties | undefined {
  const label = annotation?.customLabel?.trim() ? "custom" : annotation?.colorLabel;
  return label
    ? ({ "--storyboard-color-label": annotationColors[label] } as CSSProperties)
    : undefined;
}

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

function raiseGraphNode(layer: SVGSVGElement | null, id: string) {
  const node = layer?.querySelector<SVGGElement>(`[data-overlay-node="${CSS.escape(id)}"]`);
  if (!layer || !node || layer.lastElementChild === node) return;
  // Keep ongoing transitions when changing the paint order. Older webviews
  // need their animations restored after the ordinary DOM move.
  if (typeof layer.moveBefore === "function") layer.moveBefore(node, null);
  else {
    const animations = node.getAnimations({ subtree: true }).flatMap((animation) => {
      const effect = animation.effect;
      return effect instanceof KeyframeEffect && effect.target
        ? [
            {
              target: effect.target,
              frames: effect.getKeyframes(),
              timing: effect.getTiming(),
              time: animation.currentTime,
            },
          ]
        : [];
    });
    layer.appendChild(node);
    for (const animation of animations) {
      const resumed = animation.target.animate(animation.frames, animation.timing);
      resumed.currentTime = animation.time;
    }
  }
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
  spray?: { historyGroupId: string };
}

type GraphNodeEvent = MouseEvent<HTMLElement>;

// A stable HTML hit target preserves focus and pointer capture while the SVG
// paint can move to the top of its layer independently.
const GraphHitNode = memo(function GraphHitNode({
  node,
  scale,
  shot,
  title,
  selected,
  hovered,
  neighbor,
  hoverEnabled,
  tabIndex,
  previewId,
  onHover,
  onLeave,
  onBlur,
  onSelect,
}: {
  node: StoryboardGraphNode;
  scale: number;
  shot: StoryboardShot;
  title: string;
  selected: boolean;
  hovered: boolean;
  neighbor: boolean;
  hoverEnabled: boolean;
  tabIndex: number;
  previewId: string;
  onHover: (id: string) => void;
  onLeave: (event: { relatedTarget: EventTarget | null }) => void;
  onBlur: () => void;
  onSelect: (event: GraphNodeEvent, shot: StoryboardShot, group: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`storyboard-graph-dot ${selected ? "is-selected" : ""} ${hovered ? "is-hovered" : ""} ${neighbor ? "is-neighbor" : ""}`}
      data-storyboard-shot-id={node.id}
      style={{
        left: node.x,
        top: node.y,
        width: node.radius * 2 * scale,
        height: node.radius * 2 * scale,
      }}
      aria-label={title}
      aria-pressed={selected}
      aria-describedby={hovered ? previewId : undefined}
      tabIndex={tabIndex}
      onPointerEnter={
        hoverEnabled
          ? (event) => {
              if (!event.buttons) onHover(node.id);
            }
          : undefined
      }
      onPointerLeave={hoverEnabled ? onLeave : undefined}
      onFocus={hoverEnabled ? () => onHover(node.id) : undefined}
      onBlur={hoverEnabled ? onBlur : undefined}
      onClick={(event) => onSelect(event, shot, false)}
      onDoubleClick={(event) => onSelect(event, shot, true)}
    />
  );
});

// Selection keeps exactly the same disc, stroke and radius. Camera zoom updates
// geometry immediately; only hover animates the inner group's scale.
const GraphNode = memo(function GraphNode({
  node,
  x,
  y,
  nodeScale,
  selected,
  hovered,
  neighbor,
  annotation,
}: {
  node: StoryboardGraphNode;
  x: number;
  y: number;
  nodeScale: number;
  selected: boolean;
  hovered: boolean;
  neighbor: boolean;
  annotation?: StoryboardShotAnnotation;
}) {
  const scale = hovered ? graphDotHoverScale : 1;
  const ring = storyboardGraphSelectionRing(node.radius * nodeScale, scale);
  return (
    <g
      data-overlay-node={node.id}
      transform={`translate(${x}, ${y})`}
      style={annotationStyle(annotation)}
      className={`storyboard-graph-dot-visual ${selected ? "is-selected" : ""} ${hovered ? "is-hovered" : ""} ${neighbor ? "is-neighbor" : ""}`}
    >
      <g className="storyboard-graph-node-paint">
        <circle
          data-graph-node={node.id}
          data-selection-node={selected ? node.id : undefined}
          className={`storyboard-graph-node ${selected ? "storyboard-graph-selected-node" : ""}`}
          r={(node.radius - 0.5) * nodeScale}
          strokeWidth={nodeScale}
        />
        {selected && (
          <circle
            data-selection-ring={node.id}
            r={ring.radius / scale}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
    </g>
  );
});

// Retain only the fading neighborhood. Removing it after its transition keeps
// line colors smooth on leave without delaying the start of that transition.
const GraphHighlightedEdges = memo(function GraphHighlightedEdges({
  edges,
  nodes,
}: {
  edges: StoryboardGraph["edges"];
  nodes: StoryboardGraph["nodes"];
}) {
  const [retained, setRetained] = useState({ edges, nodes });
  const active = useMemo(() => new Set(edges), [edges]);
  const painted = new Set([...(retained.nodes === nodes ? retained.edges : []), ...edges]);
  useLayoutEffect(() => {
    setRetained((previous) => ({
      nodes,
      edges: [...new Set([...(previous.nodes === nodes ? previous.edges : []), ...edges])],
    }));
    const timer = window.setTimeout(() => setRetained({ edges, nodes }), graphHoverDurationMs);
    return () => window.clearTimeout(timer);
  }, [edges, nodes]);
  return (
    <>
      {[...painted].map((edge) => {
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        return (
          <line
            key={`${edge.source}:${edge.target}`}
            className={active.has(edge) ? "is-highlighted" : "is-exiting"}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            vectorEffect="non-scaling-stroke"
            onTransitionEnd={(event) => {
              if (
                event.propertyName === "opacity" &&
                !active.has(edge) &&
                Number(getComputedStyle(event.currentTarget).opacity) === 0
              )
                setRetained((previous) =>
                  previous.edges.includes(edge)
                    ? { ...previous, edges: previous.edges.filter((item) => item !== edge) }
                    : previous,
                );
            }}
          />
        );
      })}
    </>
  );
});

// Keep visible previews in a stable DOM order: moving even a keyed element can
// restart its CSS entry transition. Distance and hover affect only z-index.
// Departing previews remain mounted for their fade-out and can reverse it.
function GraphPreviewPresence({
  previews,
  enabled,
  children,
}: {
  previews: StoryboardGraphPreview[];
  enabled: boolean;
  children: (preview: StoryboardGraphPreview, exiting: boolean, onExited: () => void) => ReactNode;
}) {
  const [retained, setRetained] = useState(previews);
  const active = new Map(previews.map((preview) => [preview.node.id, preview]));
  const painted = new Map(retained.map((preview) => [preview.node.id, preview]));
  for (const preview of previews) painted.set(preview.node.id, preview);
  useLayoutEffect(() => {
    if (!enabled) {
      setRetained([]);
      return;
    }
    setRetained((previous) => {
      const merged = new Map(previous.map((preview) => [preview.node.id, preview]));
      for (const preview of previews) merged.set(preview.node.id, preview);
      return [...merged.values()];
    });
    const activeIds = new Set(previews.map((preview) => preview.node.id));
    const timer = window.setTimeout(
      () => setRetained((previous) => previous.filter((preview) => activeIds.has(preview.node.id))),
      graphHoverDurationMs,
    );
    return () => window.clearTimeout(timer);
  }, [previews, enabled]);
  return enabled
    ? [...painted.values()].map((preview) =>
        children(preview, !active.has(preview.node.id), () => {
          setRetained((previous) => previous.filter((item) => item.node.id !== preview.node.id));
        }),
      )
    : null;
}

export function StoryboardGraphCanvas({
  graph,
  shots,
  sourceForShot,
  shotTitle,
  selectedShotIds,
  shotAnnotations = emptyAnnotations,
  sprayActive = false,
  onSprayShots,
  onExitSpray,
  onContextMenu,
  onSelectionChange,
  onActivateShot,
  children,
}: StoryboardGraphCanvasProps) {
  const panelActive = usePanelActive();
  const stageRef = useRef<HTMLDivElement>(null);
  const nodePaintRef = useRef<SVGSVGElement>(null);
  const overviewRef = useRef<SVGSVGElement>(null);
  const previewId = useId();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
  const resetHover = useCallback(() => {
    setHoveredId(null);
    setHoveredPreviewId(null);
  }, []);
  const hoverNode = useCallback((id: string) => {
    raiseGraphNode(nodePaintRef.current, id);
    setHoveredPreviewId(null);
    setHoveredId(id);
  }, []);
  const leaveHover = useCallback(
    (event: { relatedTarget: EventTarget | null }) => {
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest(".storyboard-graph-preview, .storyboard-graph-hover-bridge")
      )
        return;
      resetHover();
    },
    [resetHover],
  );
  const [dragging, setDragging] = useState<"canvas" | "overview" | null>(null);
  const [navigationTool, setTool] = useState<StoryboardGraphTool>("pointer");
  const tool = sprayActive ? "pointer" : navigationTool;
  const spraySequenceRef = useRef(0);
  const lastSprayClickRef = useRef<{ id: string; historyGroupId: string } | null>(null);
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
  const callbacksRef = useRef({ onSelectionChange, onActivateShot, onSprayShots });
  callbacksRef.current = { onSelectionChange, onActivateShot, onSprayShots };
  const commitSelection = useCallback((ids: ReadonlySet<string>) => {
    selectionRef.current = ids;
    callbacksRef.current.onSelectionChange(ids);
  }, []);
  const nodes = useGraphNodeMotion(graph?.nodes ?? emptyNodes);
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
  const camera = useMemo(
    () =>
      constrainStoryboardGraphCamera(navigation ? navigation.camera : initialCamera, size, canvas),
    [navigation, graph, initialCamera, size, canvas],
  );
  const cameraRef = useRef(camera);
  useLayoutEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  const cameraFrameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
    },
    [],
  );
  const hoverEnabled = camera.zoom > graphHoverMinPixelsPerWorldUnit;
  const nodeScale = storyboardGraphNodeScale(camera.zoom);
  const activeHoveredId = hoverEnabled ? hoveredId : null;
  const panRef = useRef<{ id: number; x: number; y: number; camera: StoryboardGraphCamera } | null>(
    null,
  );
  const overviewDragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const updateCamera = useCallback(
    (update: (current: StoryboardGraphCamera) => StoryboardGraphCamera) => {
      const next = constrainStoryboardGraphCamera(update(cameraRef.current), size, canvas);
      cameraRef.current = next;
      if (cameraFrameRef.current === null)
        cameraFrameRef.current = requestAnimationFrame(() => {
          cameraFrameRef.current = null;
          setNavigation({ graph, camera: cameraRef.current });
        });
    },
    [graph, size, canvas],
  );

  const shotsById = useMemo(() => new Map(shots.map((shot) => [shot.id, shot])), [shots]);
  const visibleNodes = useMemo(
    () => nodes.filter((node) => shotsById.has(node.id)),
    [nodes, shotsById],
  );
  const visibleNodeKey = useMemo(
    () => JSON.stringify(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );
  const nodesById = useMemo(
    () => new Map(visibleNodes.map((node) => [node.id, node])),
    [visibleNodes],
  );
  const neighborhoods = useMemo(
    () => (graph ? indexStoryboardGraphNeighborhoods(graph) : new Map<string, Set<string>>()),
    [graph],
  );
  const edges = useMemo(
    () =>
      graph?.edges.filter(
        (edge) => shotsById.has(nodes[edge.source].id) && shotsById.has(nodes[edge.target].id),
      ) ?? [],
    [graph, nodes, shotsById],
  );
  const neighborhood = activeHoveredId
    ? (neighborhoods.get(activeHoveredId) ?? emptyNeighborhood)
    : emptyNeighborhood;
  const viewport = useMemo(() => storyboardGraphViewport(camera, size), [camera, size]);
  const overviewViewport = storyboardGraphOverviewPoint(viewport, overviewCanvas);
  const hoveredNode = activeHoveredId ? nodesById.get(activeHoveredId) : undefined;
  const revealNeighbors =
    tool === "hand" || Boolean(hoveredNode && !selectedShotIds.has(hoveredNode.id));
  const previewEmphasis = useMemo(() => {
    if (tool !== "pointer") return null;
    if (hoveredPreviewId) {
      return !selectedShotIds.has(hoveredPreviewId) && graph
        ? (neighborhoods.get(hoveredPreviewId) ?? emptyNeighborhood)
        : new Set([hoveredPreviewId]);
    }
    return activeHoveredId && selectedShotIds.has(activeHoveredId)
      ? new Set([activeHoveredId])
      : null;
  }, [tool, hoveredPreviewId, activeHoveredId, selectedShotIds, graph, neighborhoods]);
  const previewWidth = Math.max(
    1,
    Math.min(previewMaxWidth, size.width - 16, ((size.height - 48) * 16) / 9),
  );
  const previewHeight = (previewWidth * 9) / 16;
  const previews = useMemo<StoryboardGraphPreview[]>(() => {
    if (!hoverEnabled) return [];
    const ids = new Set(selectedShotIds);
    if (revealNeighbors) for (const id of neighborhood) ids.add(id);
    else if (hoveredNode) ids.add(hoveredNode.id);
    const candidates = [...ids]
      .flatMap((id) => {
        const node = nodesById.get(id);
        return node ? [node] : [];
      })
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
      const dotScale = candidate.node.id === hoveredNode?.id ? graphDotHoverScale : 1;
      const previewDistance =
        candidate.node.radius * nodeScale * dotScale +
        previewTipGap +
        (selected
          ? storyboardGraphSelectionRing(candidate.node.radius * nodeScale, dotScale).gap + 1
          : 0) +
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
    revealNeighbors,
    neighborhood,
    selectedShotIds,
    nodesById,
    shotsById,
    sourceForShot,
    camera,
    nodeScale,
    size,
    previewWidth,
    previewHeight,
  ]);

  const projectedNodes = useMemo(
    () =>
      visibleNodes.flatMap((node) => {
        const point = storyboardGraphScreenPoint(node, camera, size);
        const margin =
          storyboardGraphSelectionRing(node.radius * nodeScale, graphDotHoverScale).radius + 2;
        return point.x < -margin ||
          point.x > size.width + margin ||
          point.y < -margin ||
          point.y > size.height + margin
          ? []
          : [{ node, ...point }];
      }),
    [visibleNodes, camera, size, nodeScale],
  );
  const incidentEdges = useMemo(() => {
    const result = new Map<string, StoryboardGraph["edges"]>();
    for (const edge of edges)
      for (const index of [edge.source, edge.target]) {
        const id = nodes[index].id;
        const incident = result.get(id);
        if (incident) incident.push(edge);
        else result.set(id, [edge]);
      }
    return result;
  }, [edges, nodes]);
  const highlightedEdges = useMemo(() => {
    const result = new Set<StoryboardGraph["edges"][number]>();
    for (const id of neighborhood)
      for (const edge of incidentEdges.get(id) ?? [])
        if (neighborhood.has(nodes[edge.source].id) && neighborhood.has(nodes[edge.target].id))
          result.add(edge);
    return [...result];
  }, [neighborhood, incidentEdges, nodes]);
  // Batch static edges by opacity. Hover updates only the small highlighted
  // neighborhood, rather than thousands of individual SVG attributes.
  const edgePaths = useMemo(() => {
    const paths = new Map<number, string[]>();
    for (const edge of edges) {
      const a = nodes[edge.source];
      const b = nodes[edge.target];
      if (
        Math.max(a.x, b.x) < viewport.x ||
        Math.min(a.x, b.x) > viewport.x + viewport.width ||
        Math.max(a.y, b.y) < viewport.y ||
        Math.min(a.y, b.y) > viewport.y + viewport.height
      )
        continue;
      const opacity = Math.round((0.08 + edge.similarity * 0.14) * 100) / 100;
      let segments = paths.get(opacity);
      if (!segments) paths.set(opacity, (segments = []));
      segments.push(`M${a.x},${a.y}L${b.x},${b.y}`);
    }
    return [...paths].map(([opacity, segments]) => (
      <path
        key={opacity}
        className="storyboard-graph-base-edges"
        d={segments.join("")}
        opacity={opacity}
        vectorEffect="non-scaling-stroke"
      />
    ));
  }, [edges, nodes, viewport]);
  const hoverBridges = hoveredNode
    ? previews
        .filter(
          (preview) =>
            preview.node.id === hoveredNode.id ||
            (revealNeighbors && !selectedShotIds.has(preview.node.id)),
        )
        .map((preview) => {
          const point = storyboardGraphScreenPoint(hoveredNode, camera, size);
          const edgeY = preview.above ? preview.top + previewHeight : preview.top;
          const radius = hoveredNode.radius * nodeScale * graphDotHoverScale;
          return (
            <polygon
              key={preview.node.id}
              className="storyboard-graph-hover-bridge"
              points={`${point.x - radius},${point.y} ${point.x + radius},${point.y} ${preview.left + previewWidth},${edgeY} ${preview.left},${edgeY}`}
              onPointerLeave={leaveHover}
              aria-hidden="true"
            />
          );
        })
    : null;

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
        if (selection.active && restoreSelection && !selection.spray)
          commitSelection(selection.base);
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
    lastSprayClickRef.current = null;
    cancelGestures(false);
  }, [graph, visibleNodeKey, sprayActive, cancelGestures, resetHover]);

  useEffect(() => {
    if (!panelActive) {
      cancelGestures();
      resetHover();
    }
  }, [panelActive, cancelGestures, resetHover]);

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

  function marqueeHits(gesture: MarqueeGesture, point: { x: number; y: number }) {
    const start = storyboardGraphWorldPoint(gesture.start, gesture.camera, size);
    const end = storyboardGraphWorldPoint(point, gesture.camera, size);
    return storyboardGraphMarqueeHitIds(visibleNodes, storyboardGraphSelectionRect(start, end));
  }

  const newSprayHistoryGroup = useCallback(() => {
    return `storyboard-graph-spray-${previewId}-${Date.now()}-${++spraySequenceRef.current}`;
  }, [previewId]);

  function updateMarquee(gesture: MarqueeGesture, point: { x: number; y: number }) {
    gesture.active = true;
    gesture.point = point;
    window.clearTimeout(gesture.timer);
    suppressClickRef.current = true;
    resetHover();
    const rect = storyboardGraphSelectionRect(gesture.start, point);
    setMarquee(rect);
    if (!gesture.spray)
      commitSelection(
        applyStoryboardGraphSelection(gesture.base, marqueeHits(gesture, point), gesture.mode),
      );
  }

  function startCanvasGesture(event: PointerEvent<HTMLDivElement>) {
    if (!graph || !event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        ".storyboard-graph-tools, .storyboard-graph-navigator, .storyboard-graph-minimap, .storyboard-graph-message",
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
        spray: sprayActive ? { historyGroupId: newSprayHistoryGroup() } : undefined,
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
      if (selection.active) {
        const point = canvasPoint(event);
        updateMarquee(selection, point);
        if (selection.spray) {
          const hits = marqueeHits(selection, point);
          if (hits.size)
            callbacksRef.current.onSprayShots?.(hits, selection.spray.historyGroupId, event.altKey);
        }
      }
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

  const selectNode = useCallback(
    (event: GraphNodeEvent, shot: StoryboardShot, group: boolean) => {
      event.preventDefault();
      event.stopPropagation();
      if (tool !== "pointer" || suppressClickRef.current || (!group && event.detail > 1)) return;
      const hits =
        group && graph
          ? new Set(
              [...(neighborhoods.get(shot.id) ?? emptyNeighborhood)].filter((id) =>
                shotsById.has(id),
              ),
            )
          : new Set([shot.id]);
      if (sprayActive) {
        const historyGroupId =
          group && lastSprayClickRef.current?.id === shot.id
            ? lastSprayClickRef.current.historyGroupId
            : newSprayHistoryGroup();
        if (!group) lastSprayClickRef.current = { id: shot.id, historyGroupId };
        callbacksRef.current.onSprayShots?.(hits, historyGroupId, event.altKey);
        return;
      }
      const previous = lastClickRef.current;
      const base =
        group && previous?.id === shot.id && previous.mode === selectionMode
          ? previous.base
          : new Set(selectionRef.current);
      if (!group) lastClickRef.current = { id: shot.id, base, mode: selectionMode };
      commitSelection(applyStoryboardGraphSelection(base, hits, selectionMode));
      callbacksRef.current.onActivateShot(shot);
    },
    [
      tool,
      sprayActive,
      graph,
      neighborhoods,
      shotsById,
      newSprayHistoryGroup,
      selectionMode,
      commitSelection,
    ],
  );

  function changeTool(next: StoryboardGraphTool) {
    cancelGestures();
    resetHover();
    lastClickRef.current = null;
    onExitSpray?.();
    setTool(next);
  }

  const overviewEdgePath = useMemo(
    () =>
      edges
        .map((edge) => {
          const a = storyboardGraphOverviewPoint(nodes[edge.source], overviewCanvas);
          const b = storyboardGraphOverviewPoint(nodes[edge.target], overviewCanvas);
          return `M${a.x},${a.y}L${b.x},${b.y}`;
        })
        .join(""),
    [edges, nodes, overviewCanvas],
  );
  const overviewGeometry = useMemo(
    () => (
      <g className="storyboard-graph-minimap-content" pointerEvents="none">
        <path d={overviewEdgePath} />
        {visibleNodes.map((node) => {
          const point = storyboardGraphOverviewPoint(node, overviewCanvas);
          return (
            <circle
              key={node.id}
              cx={point.x}
              cy={point.y}
              r={0.8}
              className={selectedShotIds.has(node.id) ? "is-selected" : ""}
              style={annotationStyle(shotAnnotations[node.id])}
            />
          );
        })}
      </g>
    ),
    [overviewEdgePath, overviewCanvas, visibleNodes, selectedShotIds, shotAnnotations],
  );

  return (
    <div
      ref={stageRef}
      className={`storyboard-graph-view is-${tool} ${sprayActive ? "is-spraying" : ""} ${hoveredNode ? "has-focus" : ""} ${dragging === "canvas" ? "is-panning" : ""} ${marquee ? "is-selecting" : ""}`}
      style={
        {
          "--storyboard-graph-dot-hover-scale": `${graphDotHoverScale}`,
          "--storyboard-graph-hover-duration": `${graphHoverDurationMs}ms`,
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
      onContextMenu={(event) => {
        if (tool === "pointer" && !sprayActive) onContextMenu?.(event);
        else event.preventDefault();
      }}
      onClickCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(
            ".storyboard-graph-tools, .storyboard-graph-navigator, .storyboard-graph-minimap",
          )
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
            "button, .storyboard-graph-navigator, .storyboard-graph-minimap, .storyboard-graph-tools, .storyboard-graph-message",
          )
        )
          return;
        if (tool === "pointer" && !sprayActive)
          commitSelection(
            applyStoryboardGraphSelection(selectionRef.current, new Set(), selectionMode),
          );
      }}
      onPointerLeave={resetHover}
      onKeyDown={navigateKeyboard}
    >
      <svg
        className="storyboard-graph-hover-bridges"
        width={size.width}
        height={size.height}
        aria-hidden="true"
      >
        {hoverBridges}
      </svg>
      <div
        className="storyboard-graph-world"
        style={{
          transform: `translate(${size.width / 2 - camera.x * camera.zoom}px, ${size.height / 2 - camera.y * camera.zoom}px) scale(${camera.zoom})`,
        }}
      >
        <svg className="storyboard-graph-edges" width={1} height={1} aria-hidden="true">
          {edgePaths}
          <GraphHighlightedEdges edges={highlightedEdges} nodes={nodes} />
        </svg>
        <div className="storyboard-graph-hit-nodes" role="group" aria-label="????">
          {projectedNodes.map(({ node }) => (
            <GraphHitNode
              key={node.id}
              node={node}
              scale={nodeScale / camera.zoom}
              shot={shotsById.get(node.id)!}
              title={shotTitle(shotsById.get(node.id)!)}
              selected={selectedShotIds.has(node.id)}
              hovered={activeHoveredId === node.id}
              neighbor={neighborhood.has(node.id)}
              hoverEnabled={hoverEnabled}
              tabIndex={tool === "pointer" ? 0 : -1}
              previewId={previewId}
              onHover={hoverNode}
              onLeave={leaveHover}
              onBlur={resetHover}
              onSelect={selectNode}
            />
          ))}
        </div>
      </div>
      <svg
        ref={nodePaintRef}
        className="storyboard-graph-selection-rings storyboard-graph-nodes"
        width={size.width}
        height={size.height}
        aria-hidden="true"
      >
        {projectedNodes.map(({ node, x, y }) => (
          <GraphNode
            key={node.id}
            node={node}
            x={x}
            y={y}
            nodeScale={nodeScale}
            selected={selectedShotIds.has(node.id)}
            hovered={activeHoveredId === node.id}
            neighbor={neighborhood.has(node.id)}
            annotation={shotAnnotations[node.id]}
          />
        ))}
      </svg>
      {marquee && (
        <div
          className="storyboard-graph-marquee"
          aria-hidden="true"
          style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
        />
      )}
      <div className="storyboard-graph-previews">
        <GraphPreviewPresence previews={previews} enabled={hoverEnabled}>
          {(preview, exiting, onExited) => {
            const isHovered = preview.node.id === hoveredNode?.id;
            const isSelected = selectedShotIds.has(preview.node.id);
            const shot = shotsById.get(preview.node.id);
            if (!shot) return null;
            const colorStyle = annotationStyle(shotAnnotations[preview.node.id]);
            return (
              <div
                key={preview.node.id}
                id={isHovered ? previewId : undefined}
                role={isHovered ? "tooltip" : undefined}
                data-preview-shot-id={preview.node.id}
                data-storyboard-shot-id={preview.node.id}
                inert={exiting}
                aria-hidden={exiting || undefined}
                onTransitionEnd={(event) => {
                  if (
                    exiting &&
                    event.target === event.currentTarget &&
                    event.propertyName === "opacity" &&
                    Number(getComputedStyle(event.currentTarget).opacity) === 0
                  )
                    onExited();
                }}
                className={`storyboard-graph-preview ${preview.above ? "is-above" : "is-below"}${colorStyle ? " has-color-label" : ""}${isSelected ? " is-selected" : ""}${!isHovered && !isSelected ? " is-neighbor" : ""}${previewEmphasis && !previewEmphasis.has(preview.node.id) ? " is-muted" : ""}${exiting ? " is-exiting" : ""}`}
                onPointerEnter={() => {
                  setHoveredPreviewId(preview.node.id);
                }}
                onPointerLeave={(event) => {
                  setHoveredPreviewId(null);
                  leaveHover(event);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (sprayActive) selectNode(event, shot, false);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (sprayActive) selectNode(event, shot, true);
                }}
                style={
                  {
                    width: previewWidth,
                    left: preview.left,
                    top: preview.top,
                    ...colorStyle,
                    zIndex:
                      tool === "pointer" &&
                      (isHovered || isSelected) &&
                      preview.node.id === hoveredPreviewId
                        ? previews.length + 4
                        : preview.zIndex,
                    "--storyboard-graph-preview-caret": `${preview.caret}px`,
                    "--storyboard-graph-preview-arrow-gap": `${previewFrameGap}px`,
                    "--storyboard-graph-preview-arrow-height": `${previewArrowHeight}px`,
                  } as CSSProperties
                }
              >
                <StoryboardGraphThumbnail
                  shot={shot}
                  source={preview.source}
                  annotation={shotAnnotations[preview.node.id]}
                  thumbnailFrame={preview.node.thumbnailFrame}
                  priority={preview.priority}
                  requestEnabled={panelActive && Boolean(preview.source.videoPath)}
                />
              </div>
            );
          }}
        </GraphPreviewPresence>
      </div>
      {children}
      <StoryboardGraphTools
        tool={tool}
        mode={selectionMode}
        sprayActive={sprayActive}
        onToolChange={changeTool}
        onModeChange={(next) => {
          cancelGestures();
          lastClickRef.current = null;
          setSelectionMode(next);
        }}
      />
      <div className="storyboard-graph-navigator">
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
    </div>
  );
}
