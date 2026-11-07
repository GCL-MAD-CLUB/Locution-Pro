import { useEffect, useMemo, useRef, useState } from "react";
import type { StoryboardGraph, StoryboardGraphVector } from "../../core/editor/storyboardGraph";
import { clientError, invokeCommand, runOperation } from "../../errors";
import { ensureStoryboardSemanticIndex, type SemanticShot } from "./storyboardSemanticSearch";
import {
  defaultStoryboardGraphOptions,
  type StoryboardGraphOptions,
} from "../../core/editor/storyboardGraphOptions";

type GraphState =
  | { status: "indexing" | "reading" | "neighbors" | "layout"; fraction?: number }
  | { status: "ready"; graph: StoryboardGraph }
  | { status: "cancelled" | "failed"; message: string };

export function useStoryboardGraph(
  shots: readonly SemanticShot[],
  scope: string,
  enabled: boolean,
  options: StoryboardGraphOptions = defaultStoryboardGraphOptions,
) {
  const indexKey = useMemo(() => JSON.stringify([scope, shots]), [scope, shots]);
  const key = JSON.stringify([indexKey, options.minSimilarity, options.maxDegree]);
  const cachedVectors = useRef<{ key: string; vectors: StoryboardGraphVector[] } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: GraphState } | null>(null);
  useEffect(() => {
    if (!enabled || !shots.length) return;
    let active = true;
    let worker: Worker | undefined;
    let finishLayout: ((graph: StoryboardGraph | null) => void) | undefined;
    const update = (state: GraphState) => {
      if (active) setResult({ key, state });
    };
    const cached =
      cachedVectors.current?.key === indexKey ? cachedVectors.current.vectors : undefined;
    update({ status: cached ? "neighbors" : "indexing" });
    void runOperation("storyboard.graph", async () => {
      let vectors = cached;
      if (!vectors) {
        const indexed = await ensureStoryboardSemanticIndex(shots, scope);
        if (!active) return;
        if (indexed !== "ready") {
          update({
            status: indexed === "cancelled" ? "cancelled" : "failed",
            message: indexed === "cancelled" ? "索引构建已取消。" : "分镜索引构建失败，请重试。",
          });
          return;
        }
        update({ status: "reading" });
        vectors = await invokeCommand<StoryboardGraphVector[]>("read_storyboard_graph_vectors", {
          shots,
        });
        if (!active) return;
        if (vectors.length !== shots.length)
          throw clientError("UNEXPECTED_ERROR", "Incomplete storyboard graph vectors");
        cachedVectors.current = { key: indexKey, vectors };
      }
      update({ status: "neighbors", fraction: 0 });
      worker = new Worker(new URL("./storyboardGraph.worker.ts", import.meta.url), {
        type: "module",
      });
      const layoutWorker = worker;
      const graph = await new Promise<StoryboardGraph | null>((resolve, reject) => {
        finishLayout = resolve;
        layoutWorker.onmessage = (
          event: MessageEvent<
            | { type: "progress"; phase: "neighbors" | "layout"; fraction: number }
            | { type: "ready"; graph: StoryboardGraph }
            | { type: "failed"; message: string }
          >,
        ) => {
          const message = event.data;
          if (message.type === "progress") {
            update({ status: message.phase, fraction: message.fraction });
          } else {
            if (message.type === "ready") resolve(message.graph);
            else reject(clientError("UNEXPECTED_ERROR", message.message));
            layoutWorker.terminate();
          }
        };
        layoutWorker.onerror = () => {
          reject(clientError("UNEXPECTED_ERROR", "Storyboard graph worker failed"));
          layoutWorker.terminate();
        };
        layoutWorker.postMessage({ vectors, options });
      });
      if (graph) update({ status: "ready", graph });
    }).then((outcome) => {
      if (outcome.status === "failed")
        update({ status: "failed", message: "无法生成图谱，请检查语义索引后重试。" });
      if (outcome.status === "cancelled")
        update({ status: "cancelled", message: "图谱生成已取消。" });
    });
    return () => {
      active = false;
      finishLayout?.(null);
      worker?.terminate();
    };
  }, [key, enabled, attempt]);
  return {
    state: result?.key === key ? result.state : ({ status: "indexing" } as GraphState),
    retry: () => setAttempt((value) => value + 1),
  };
}
