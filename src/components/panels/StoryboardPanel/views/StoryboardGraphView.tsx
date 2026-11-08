import { Network } from "lucide-react";
import { useMemo } from "react";
import { useStoryboardGraph } from "../../../../application/media/storyboardGraph";
import type { SemanticShot } from "../../../../application/media/storyboardSemanticSearch";
import { usePanelActive } from "../../../../runtime/systems/PanelState";
import { StoryboardGraphCanvas, type StoryboardGraphCanvasProps } from "./StoryboardGraphCanvas";

interface StoryboardGraphViewProps extends Omit<
  StoryboardGraphCanvasProps,
  "graph" | "children" | "preparing"
> {
  semanticShots: readonly SemanticShot[];
  scope: string;
  available: boolean;
}

function GraphError({ state, retry }: ReturnType<typeof useStoryboardGraph>) {
  if ("message" in state)
    return (
      <div className="storyboard-graph-message" role="status">
        <span>{state.message}</span>
        <button type="button" onClick={retry}>
          重新生成图谱
        </button>
      </div>
    );
  return null;
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
    available && panelActive && props.shots.length > 0,
    undefined,
    visibleIds,
  );
  const empty = !semanticShots.length || !props.shots.length;
  if (empty)
    return <div className="storyboard-graph-view" role="region" aria-label="分镜语义图谱" />;
  return (
    <StoryboardGraphCanvas
      key={scope}
      {...props}
      graph={result.graph}
      preparing={available && !result.graph && !("message" in result.state)}
    >
      {!available ? (
        <div className="storyboard-graph-message" role="status">
          <Network aria-hidden="true" />
          <span>图谱视图需要安装分镜语义检索组件。</span>
        </div>
      ) : (
        <GraphError {...result} />
      )}
    </StoryboardGraphCanvas>
  );
}
