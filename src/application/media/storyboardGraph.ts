import { useEffect, useMemo, useRef, useState } from "react";
import {
  serializeStoryboardGraphOptions,
  type StoryboardGraph,
  type StoryboardGraphVector,
} from "../../core/editor/storyboardGraph/graph";
import { clientError, invokeCommand, runOperation } from "../../errors";
import { ensureStoryboardSemanticIndex, type SemanticShot } from "./storyboardSemanticSearch";
import {
  defaultStoryboardGraphOptions,
  type StoryboardGraphOptions,
} from "../../core/editor/storyboardGraph/options";

type GraphState =
  | { status: "indexing" | "reading" | "neighbors" | "layout"; fraction?: number }
  | { status: "ready"; graph: StoryboardGraph }
  | { status: "cancelled" | "failed"; message: string };

export function useStoryboardGraph(
  shots: readonly SemanticShot[],
  scope: string,
  enabled: boolean,
  options: StoryboardGraphOptions = defaultStoryboardGraphOptions,
  visibleShotIds: readonly string[] = shots.map((shot) => shot.id),
) {
  const indexKey = useMemo(
    () => JSON.stringify([scope, [...shots].sort((a, b) => a.id.localeCompare(b.id))]),
    [scope, shots],
  );
  const workerOptions = useMemo(
    () => serializeStoryboardGraphOptions(options, shots.length),
    [options, shots.length],
  );
  const key = JSON.stringify([indexKey, [...visibleShotIds].sort(), workerOptions]);
  const cachedVectors = useRef<{
    scope: string;
    entries: Map<string, { key: string; vector: StoryboardGraphVector }>;
    vectors: StoryboardGraphVector[];
  } | null>(null);
  const layout = useRef<{ worker: Worker; vectors?: StoryboardGraphVector[] } | null>(null);
  const lastGraph = useRef<{ scope: string; graph: StoryboardGraph } | null>(null);
  const sequence = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: GraphState } | null>(null);
  useEffect(
    () => () => {
      layout.current?.worker.terminate();
    },
    [],
  );
  useEffect(() => {
    if (!enabled) return;
    if (!shots.length) {
      const { nodeRadii: _, ...settings } = workerOptions;
      const graph: StoryboardGraph = { nodes: [], edges: [], neighbors: 0, ...settings };
      lastGraph.current = { scope, graph };
      setResult({ key, state: { status: "ready", graph } });
      return;
    }
    let active = true;
    const requestId = ++sequence.current;
    let finishLayout: ((graph: StoryboardGraph | null) => void) | undefined;
    const update = (state: GraphState) => {
      if (active) setResult({ key, state });
    };
    if (cachedVectors.current?.scope !== scope)
      cachedVectors.current = { scope, entries: new Map(), vectors: [] };
    const cache = cachedVectors.current;
    const missing = shots.filter(
      (shot) => cache.entries.get(shot.id)?.key !== JSON.stringify(shot),
    );
    update({ status: missing.length ? "indexing" : "neighbors" });
    void runOperation("storyboard.graph", async () => {
      if (missing.length) {
        const indexed = await ensureStoryboardSemanticIndex(missing, scope);
        if (!active) return;
        if (indexed !== "ready") {
          update({
            status: indexed === "cancelled" ? "cancelled" : "failed",
            message: indexed === "cancelled" ? "索引构建已取消。" : "分镜索引构建失败，请重试。",
          });
          return;
        }
        update({ status: "reading" });
        const added = await invokeCommand<StoryboardGraphVector[]>(
          "read_storyboard_graph_vectors",
          {
            shots: missing,
          },
        );
        if (!active) return;
        const byId = new Map(added.map((vector) => [vector.id, vector]));
        if (added.length !== missing.length || missing.some((shot) => !byId.has(shot.id)))
          throw clientError("UNEXPECTED_ERROR", "Incomplete storyboard graph vectors");
        for (const shot of missing)
          cache.entries.set(shot.id, { key: JSON.stringify(shot), vector: byId.get(shot.id)! });
        cache.vectors = [...cache.entries.values()].map((entry) => entry.vector);
      }
      update({ status: "neighbors", fraction: 0 });
      if (!layout.current)
        layout.current = {
          worker: new Worker(new URL("./storyboardGraph.worker.ts", import.meta.url), {
            type: "module",
          }),
        };
      const currentLayout = layout.current;
      const layoutWorker = currentLayout.worker;
      const graph = await new Promise<StoryboardGraph | null>((resolve, reject) => {
        finishLayout = resolve;
        layoutWorker.onmessage = (
          event: MessageEvent<
            | {
                type: "progress";
                requestId: number;
                phase: "neighbors" | "layout";
                fraction: number;
              }
            | { type: "ready"; requestId: number; graph: StoryboardGraph }
            | { type: "failed"; requestId: number; message: string }
          >,
        ) => {
          const message = event.data;
          if (!active || message.requestId !== requestId) return;
          if (message.type === "progress") {
            update({ status: message.phase, fraction: message.fraction });
          } else {
            if (message.type === "ready") resolve(message.graph);
            else reject(clientError("UNEXPECTED_ERROR", message.message));
          }
        };
        layoutWorker.onerror = () => {
          reject(clientError("UNEXPECTED_ERROR", "Storyboard graph worker failed"));
          layoutWorker.terminate();
          if (layout.current === currentLayout) layout.current = null;
        };
        layoutWorker.postMessage({
          requestId,
          vectors: currentLayout.vectors === cache.vectors ? undefined : cache.vectors,
          visibleIds: visibleShotIds,
          positions: lastGraph.current?.scope === scope ? lastGraph.current.graph.nodes : undefined,
          options: workerOptions,
        });
        currentLayout.vectors = cache.vectors;
      });
      if (graph && active) {
        lastGraph.current = { scope, graph };
        update({ status: "ready", graph });
      }
    }).then((outcome) => {
      if (outcome.status === "failed")
        update({ status: "failed", message: "无法生成图谱，请检查语义索引后重试。" });
      if (outcome.status === "cancelled")
        update({ status: "cancelled", message: "图谱生成已取消。" });
    });
    return () => {
      active = false;
      finishLayout?.(null);
    };
  }, [key, enabled, attempt]);
  return {
    graph: lastGraph.current?.scope === scope ? lastGraph.current.graph : undefined,
    state: result?.key === key ? result.state : ({ status: "indexing" } as GraphState),
    retry: () => setAttempt((value) => value + 1),
  };
}
