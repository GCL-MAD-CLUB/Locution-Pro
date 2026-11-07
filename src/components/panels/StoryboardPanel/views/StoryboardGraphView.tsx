import { Loader2, Network } from "lucide-react";
import { useMemo } from "react";
import { useStoryboardGraph } from "../../../../application/media/storyboardGraph";
import type { SemanticShot } from "../../../../application/media/storyboardSemanticSearch";
import { usePanelActive } from "../../../../runtime/systems/PanelState";
import { StoryboardGraphCanvas, type StoryboardGraphCanvasProps } from "./StoryboardGraphCanvas";

interface StoryboardGraphViewProps extends Omit<StoryboardGraphCanvasProps, "graph" | "children"> {
  semanticShots: readonly SemanticShot[];
  scope: string;
  available: boolean;
}

const phaseLabels = {
  indexing: "正在准备分镜语义索引…",
  reading: "正在读取分镜语义向量…",
  neighbors: "正在构建近邻图…",
  layout: "正在计算图谱布局…",
};

function GraphProgress({ state, graph, retry }: ReturnType<typeof useStoryboardGraph>) {
  if (state.status === "ready") return null;
  if (graph && !("message" in state)) return null;
  if ("message" in state)
    return (
      <div className="storyboard-graph-message" role="status">
        <span>{state.message}</span>
        <button type="button" onClick={retry}>
          重新生成图谱
        </button>
      </div>
    );
  return (
    <div className="storyboard-graph-message" role="status" aria-live="polite">
      <Loader2 className="storyboard-graph-spinner" aria-hidden="true" />
      <span>{phaseLabels[state.status]}</span>
      {state.fraction !== undefined && <progress max={1} value={state.fraction} />}
    </div>
  );
}

export function StoryboardGraphView({
  semanticShots,
  scope,
  available,
  ...props
}: StoryboardGraphViewProps) {
  const panelActive = usePanelActive();
  const visibleIds = useMemo(() => props.shots.map((shot) => shot.id), [props.shots]);
  const result = useStoryboardGraph(
    semanticShots,
    scope,
    available && panelActive,
    undefined,
    visibleIds,
  );
  const empty = !semanticShots.length || !props.shots.length;
  return (
    <StoryboardGraphCanvas key={scope} {...props} graph={result.graph}>
      {empty || !available ? (
        <div className="storyboard-graph-message" role="status">
          <Network aria-hidden="true" />
          <span>{empty ? "没有可显示的分镜" : "图谱视图需要安装分镜语义检索组件。"}</span>
        </div>
      ) : (
        <GraphProgress {...result} />
      )}
    </StoryboardGraphCanvas>
  );
}
