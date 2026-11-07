import { Loader2, Network } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useStoryboardGraph } from "../../../../application/media/storyboardGraph";
import type { SemanticShot } from "../../../../application/media/storyboardSemanticSearch";
import { defaultStoryboardGraphOptions } from "../../../../core/editor/storyboardGraphOptions";
import {
  fitStoryboardGraph,
  storyboardGraphNeighborhood,
} from "../../../../core/editor/storyboardGraphLayout";
import type { PanelRowSource } from "../../../../core/editor/multiSource";
import { frameToTimeUs } from "../../../../core/editor/timeline";
import { usePanelActive } from "../../../../runtime/systems/PanelState";
import type { StoryboardShot } from "../../../../types";
import { StoryboardSemanticThumbnail } from "./StoryboardShotThumbnail";
import "./StoryboardGraphView.css";

interface StoryboardGraphViewProps {
  semanticShots: readonly SemanticShot[];
  scope: string;
  available: boolean;
  shots: readonly StoryboardShot[];
  sourceForShot: (shot: StoryboardShot) => PanelRowSource;
  shotTitle: (shot: StoryboardShot) => string;
  selectedShotIds: ReadonlySet<string>;
  onSelectShot: (event: MouseEvent<HTMLElement>, shot: StoryboardShot) => void;
}

const previewResolution = { width: 640, height: 360 } as const;
const phaseLabels = {
  indexing: "正在准备分镜语义索引…",
  reading: "正在读取分镜语义向量…",
  neighbors: "正在构建近邻图…",
  layout: "正在计算图谱布局…",
};

export function StoryboardGraphView({
  semanticShots,
  scope,
  available,
  shots,
  sourceForShot,
  shotTitle,
  selectedShotIds,
  onSelectShot,
}: StoryboardGraphViewProps) {
  const panelActive = usePanelActive();
  const [minSimilarity, setMinSimilarity] = useState(defaultStoryboardGraphOptions.minSimilarity);
  const [draftMinSimilarity, setDraftMinSimilarity] = useState(
    String(defaultStoryboardGraphOptions.minSimilarity),
  );
  const options = useMemo(
    () => ({ ...defaultStoryboardGraphOptions, minSimilarity }),
    [minSimilarity],
  );
  const { state, retry } = useStoryboardGraph(
    semanticShots,
    scope,
    available && panelActive,
    options,
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const shotsById = useMemo(() => new Map(shots.map((shot) => [shot.id, shot])), [shots]);
  const graph = state.status === "ready" ? state.graph : undefined;
  const neighborhood = useMemo(
    () => (graph && hoveredId ? storyboardGraphNeighborhood(graph, hoveredId) : new Set<string>()),
    [graph, hoveredId],
  );
  const degrees = useMemo(() => {
    const result = new Map<string, number>();
    for (const edge of graph?.edges ?? []) {
      for (const index of [edge.source, edge.target]) {
        const id = graph!.nodes[index].id;
        result.set(id, (result.get(id) ?? 0) + 1);
      }
    }
    return result;
  }, [graph]);
  const nodes = useMemo(
    () => fitStoryboardGraph(graph?.nodes ?? [], size.width, size.height),
    [graph, size],
  );
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setHoveredId(null), [graph, shots]);

  const hoveredNode = nodes.find((node) => node.id === hoveredId && shotsById.has(node.id));
  const hoveredShot = hoveredNode ? shotsById.get(hoveredNode.id) : undefined;
  const hoveredSource = hoveredShot ? sourceForShot(hoveredShot) : undefined;
  const previewWidth = Math.min(224, Math.max(1, size.width - 16));
  const visibleCount = nodes.filter((node) => shotsById.has(node.id)).length;
  const visibleEdgeCount =
    graph?.edges.filter(
      (edge) =>
        shotsById.has(graph.nodes[edge.source].id) && shotsById.has(graph.nodes[edge.target].id),
    ).length ?? 0;
  const empty = !semanticShots.length || !shots.length;

  return (
    <div className="storyboard-graph-container">
      <form
        className="storyboard-graph-controls"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(draftMinSimilarity);
          if (Number.isFinite(value) && value >= 0 && value <= 1) setMinSimilarity(value);
        }}
      >
        <label>
          最低相似度
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            required
            value={draftMinSimilarity}
            disabled={!available || !semanticShots.length}
            onChange={(event) => setDraftMinSimilarity(event.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          disabled={
            !available || !semanticShots.length || Number(draftMinSimilarity) === minSimilarity
          }
        >
          应用
        </button>
        <span title="每个分镜的最高分连线不受阈值限制，优先保留；其余连线受相似度阈值和 15 条上限限制。">
          始终保留最相似连线
        </span>
      </form>
      <div
        className={`storyboard-graph-view ${hoveredNode ? "has-focus" : ""}`}
        ref={stageRef}
        onPointerLeave={() => setHoveredId(null)}
      >
        {empty || !available ? (
          <div className="storyboard-graph-message" role="status">
            <Network aria-hidden="true" />
            <span>{empty ? "没有可显示的分镜" : "图谱视图需要安装分镜语义检索组件。"}</span>
          </div>
        ) : state.status === "ready" ? (
          <>
            <svg
              className="storyboard-graph-edges"
              width={size.width}
              height={size.height}
              aria-hidden="true"
            >
              {graph?.edges.map((edge) => {
                const source = nodes[edge.source];
                const target = nodes[edge.target];
                if (!shotsById.has(source.id) || !shotsById.has(target.id)) return null;
                const highlighted = source.id === hoveredId || target.id === hoveredId;
                return (
                  <line
                    key={`${source.id}:${target.id}`}
                    className={highlighted ? "is-highlighted" : hoveredNode ? "is-muted" : ""}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    opacity={highlighted ? 0.8 : 0.08 + edge.similarity * 0.14}
                  />
                );
              })}
            </svg>
            <div
              className={`storyboard-graph-nodes ${visibleCount <= 40 ? "has-labels" : ""}`}
              role="group"
              aria-label="分镜语义图谱"
            >
              {nodes.map((node) => {
                const shot = shotsById.get(node.id);
                if (!shot) return null;
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={`storyboard-graph-dot ${selectedShotIds.has(node.id) ? "is-selected" : ""} ${hoveredId === node.id ? "is-hovered" : ""} ${neighborhood.has(node.id) ? "is-neighbor" : ""}`}
                    style={
                      {
                        left: node.x,
                        top: node.y,
                        "--storyboard-graph-dot-size": `${6 + Math.min(4, Math.sqrt(degrees.get(node.id) ?? 0))}px`,
                      } as CSSProperties
                    }
                    aria-label={shotTitle(shot)}
                    aria-pressed={selectedShotIds.has(node.id)}
                    aria-describedby={hoveredId === node.id ? previewId : undefined}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerEnter={() => setHoveredId(node.id)}
                    onPointerLeave={() => setHoveredId(null)}
                    onFocus={() => setHoveredId(node.id)}
                    onBlur={() => setHoveredId(null)}
                    onClick={(event) => onSelectShot(event, shot)}
                  >
                    <span className="storyboard-graph-node-label" aria-hidden="true">
                      {shotTitle(shot)}
                    </span>
                  </button>
                );
              })}
            </div>
            {hoveredNode && hoveredShot && hoveredSource && (
              <div
                id={previewId}
                role="tooltip"
                className="storyboard-graph-preview"
                style={{
                  width: previewWidth,
                  left: Math.max(
                    8,
                    Math.min(size.width - previewWidth - 8, hoveredNode.x - previewWidth / 2),
                  ),
                  top: Math.max(8, hoveredNode.y - (previewWidth * 9) / 16 - 40),
                }}
              >
                <StoryboardSemanticThumbnail
                  ariaLabel="分镜选帧缩略图"
                  assetId={hoveredSource.assetId}
                  fingerprint={hoveredSource.fingerprint}
                  videoPath={hoveredSource.videoPath}
                  frameRate={hoveredSource.frameRate}
                  timeUs={frameToTimeUs(hoveredNode.thumbnailFrame, hoveredSource.frameRate)}
                  resolution={previewResolution}
                  priority={0}
                  requestEnabled={panelActive}
                />
                <span>{shotTitle(hoveredShot)}</span>
              </div>
            )}
            <div className="storyboard-graph-caption">
              <span>{visibleCount} 个分镜 · 悬停查看缩略图</span>
              <span>
                {visibleEdgeCount} 条连线 · 阈值 {graph?.minSimilarity.toFixed(2)} · 上限{" "}
                {graph?.maxDegree}
              </span>
            </div>
          </>
        ) : "message" in state ? (
          <div className="storyboard-graph-message" role="status">
            <span>{state.message}</span>
            <button type="button" onClick={retry}>
              重新生成图谱
            </button>
          </div>
        ) : (
          <div className="storyboard-graph-message" role="status" aria-live="polite">
            <Loader2 className="storyboard-graph-spinner" aria-hidden="true" />
            <span>{phaseLabels[state.status]}</span>
            {state.fraction !== undefined && <progress max={1} value={state.fraction} />}
            {state.status === "indexing" && (
              <span>首次使用需构建索引，可在任务面板查看进度或取消。</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
