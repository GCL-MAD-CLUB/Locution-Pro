import {
  buildStoryboardGraph,
  indexStoryboardGraphSimilarities,
  type StoryboardGraphNode,
  type StoryboardGraphVector,
} from "../../core/editor/storyboardGraph/graph";
import type { StoryboardGraphOptions } from "../../core/editor/storyboardGraph/options";

let vectors: StoryboardGraphVector[] = [];
let similarities: ReturnType<typeof indexStoryboardGraphSimilarities> | undefined;

self.onmessage = (
  event: MessageEvent<{
    requestId: number;
    vectors?: StoryboardGraphVector[];
    visibleIds: string[];
    positions?: StoryboardGraphNode[];
    options: StoryboardGraphOptions;
  }>,
) => {
  const { requestId, visibleIds, positions, options } = event.data;
  try {
    if (event.data.vectors) {
      vectors = event.data.vectors;
      similarities = indexStoryboardGraphSimilarities(vectors);
    }
    const visible = new Set(visibleIds);
    let lastUpdate = 0;
    const graph = buildStoryboardGraph(
      vectors.filter((shot) => visible.has(shot.id)),
      (phase, fraction) => {
        const now = performance.now();
        if (fraction < 1 && now - lastUpdate < 100) return;
        lastUpdate = now;
        self.postMessage({ type: "progress", requestId, phase, fraction });
      },
      options,
      { similarities, positions },
    );
    self.postMessage({ type: "ready", requestId, graph });
  } catch (error) {
    self.postMessage({
      type: "failed",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
