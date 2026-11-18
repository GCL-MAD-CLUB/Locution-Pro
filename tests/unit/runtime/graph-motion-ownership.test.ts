import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";
import { CommittedLifetime, RenderLifetime } from "../support/lifetime.ts";
import type { StoryboardGraphNode } from "../../../src/core/editor/storyboardGraph/graph.ts";

test("graph motion acquires its provisional simulation only after the owner commits", () => {
  let acquired = 0;
  const cancelled: number[] = [];
  const motion = createModuleLoader(import.meta.url)<
    typeof import("../../../src/components/panels/StoryboardPanel/views/useStoryboardGraphMotion.ts")
  >(
    "../../../src/components/panels/StoryboardPanel/views/useStoryboardGraphMotion.ts",
    {
      react: {
        useRef: <Value>(current: Value) => ({ current }),
        useState: <Value>(value: Value) => [value, () => {}],
        useMemo: <Value>(create: () => Value) => create(),
        useCallback: <Value>(callback: Value) => callback,
      },
      "d3-force": {},
      "../../../../core/editor/storyboardGraph/graph": {},
      "../../../../core/editor/storyboardGraph/ambient": {
        createStoryboardGraphAmbient(nodes: StoryboardGraphNode[]) {
          acquired++;
          return { nodes: nodes.map((node) => ({ ...node })), edges: [], step() {} };
        },
      },
    },
    {
      window: { matchMedia: () => ({ matches: true }) },
      performance: { now: () => 0 },
      cancelAnimationFrame: (id: number) => {
        cancelled.push(id);
      },
    },
  );
  const nodes: StoryboardGraphNode[] = [{ id: "a", x: 0, y: 0, radius: 10, thumbnailFrame: 0 }];
  const abandoned = new RenderLifetime();
  motion.useStoryboardGraphMotion(abandoned, undefined, false, nodes);
  assert.equal(acquired, 0, "an abandoned render must not start a simulation or timer");
  const lifetime = new RenderLifetime();
  const view = motion.useStoryboardGraphMotion(lifetime, undefined, false, nodes);
  assert.equal(view.phase, "ambient");
  assert.equal(acquired, 0);
  const owner = new CommittedLifetime();
  owner.commit(lifetime, "beforePaint");
  assert.equal(acquired, 1);
  owner.dispose();
  assert.equal(cancelled.length, 1);
});
