import {
  buildStoryboardGraph,
  type StoryboardGraphVector,
} from "../../core/editor/storyboardGraph";
import type { StoryboardGraphOptions } from "../../core/editor/storyboardGraphOptions";

self.onmessage = (
  event: MessageEvent<{ vectors: StoryboardGraphVector[]; options: StoryboardGraphOptions }>,
) => {
  try {
    let lastUpdate = 0;
    const graph = buildStoryboardGraph(
      event.data.vectors,
      (phase, fraction) => {
        const now = performance.now();
        if (fraction < 1 && now - lastUpdate < 100) return;
        lastUpdate = now;
        self.postMessage({ type: "progress", phase, fraction });
      },
      event.data.options,
    );
    self.postMessage({ type: "ready", graph });
  } catch (error) {
    self.postMessage({
      type: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
