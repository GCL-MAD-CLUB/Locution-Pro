import { searchSemanticPrompts } from "../../core/editor/semanticPrompts";
import {
  searchLines,
  searchQueryToMultiline,
  semanticPromptErrors,
} from "../../core/editor/textSearch";
import { Channel } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { invokeCommand, runOperation } from "../../errors";
import { normalizeError } from "../../errors/runtime";
import { createTaskProgress } from "../../systems/TaskSystem";
import { isTauriRuntime } from "../../platform/tauri/runtime";

export function useStoryboardSemanticSearchAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    void runOperation("storyboard.semanticAvailability", () =>
      invokeCommand<boolean>("storyboard_semantic_search_available"),
    ).then((outcome) => {
      if (active) setAvailable(outcome.status === "success" && outcome.value === true);
    });
    return () => {
      active = false;
    };
  }, []);
  return available;
}

export interface SemanticShot {
  id: string;
  assetId: string;
  fingerprint: string;
  startFrame: number;
  endFrame: number;
  source: string;
}
interface SemanticProgress {
  phase: "indexing" | "searching";
  completed: number;
  total: number;
}
interface SemanticMatch {
  id: string;
  similarity: number;
  frame: number;
}
interface SearchResult {
  key: string;
  scores: ReadonlyMap<string, number>;
  frames: ReadonlyMap<string, number>;
  status: "ready" | "failed";
  version: number;
  input: Pick<SearchState, "scope" | "shots" | "query" | "negativePrompts">;
}
interface SearchState {
  negativePrompts: string;
  enabled: boolean;
  query: string;
  scope: string;
  shots: readonly SemanticShot[];
  indexKey: string;
  requestKey: string;
  clearQuery: () => void;
}
interface IndexJob {
  scope: string;
  shots: ReadonlyMap<string, string>;
  cancelled: boolean;
  listeners: Set<() => void>;
  promise: Promise<"ready" | "cancelled" | "failed">;
}
const emptyScores: ReadonlyMap<string, number> = new Map();
// Same scope and storyboard content share one native job across panel instances.
const indexJobs = new Map<string, IndexJob>();
// Index membership is per shot content. Removing shots cannot invalidate the
// embeddings of those that remain, or require another native progress task.
const indexedShots = new Map<string, Map<string, string>>();
// The native text model lives for the process lifetime. Share its initialization
// across panels, but allow another attempt if loading fails or is cancelled.
let initialization: Promise<boolean> | undefined;

function containsSemanticShots(
  indexed: readonly SemanticShot[],
  requested: readonly SemanticShot[],
) {
  const keys = new Map(indexed.map((shot) => [shot.id, JSON.stringify(shot)]));
  return requested.every((shot) => keys.get(shot.id) === JSON.stringify(shot));
}

function canReuseSearch(previous: SearchResult["input"], current: SearchResult["input"]) {
  return (
    previous.scope === current.scope &&
    previous.query === current.query &&
    previous.negativePrompts === current.negativePrompts &&
    containsSemanticShots(previous.shots, current.shots)
  );
}

export function initializeStoryboardSemanticSearch(): Promise<boolean> {
  if (initialization) return initialization;
  initialization = (async () => {
    const task = await createTaskProgress({
      operation: "storyboard.semanticSearch",
      label: "正在初始化语义检索...",
      current: 0,
      total: 1,
    });
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      if (task.cancelled) return false;
      let percent = 0;
      timer = setInterval(() => {
        // Estimated loading feedback; reserve completion for the native result.
        if (percent >= 95) return;
        percent = percent < 70 ? Math.min(70, percent + 15) : Math.min(95, percent + 5);
        task.update({ current: percent / 100 });
      }, 1000);
      await invokeCommand("initialize_storyboard_semantic_search");
      return true;
    } finally {
      if (timer !== undefined) clearInterval(timer);
      task.remove();
    }
  })().then(
    (ready) => {
      if (!ready) initialization = undefined;
      return ready;
    },
    (error) => {
      initialization = undefined;
      throw normalizeError(error);
    },
  );
  return initialization;
}

function indexShots(state: Pick<SearchState, "shots" | "scope" | "indexKey">): IndexJob {
  const existing = indexJobs.get(state.indexKey);
  if (existing) return existing;
  const ready = indexedShots.get(state.scope) ?? new Map<string, string>();
  const missing = state.shots.filter((shot) => ready.get(shot.id) !== JSON.stringify(shot));
  const covering = [...indexJobs.values()].find(
    (job) =>
      job.scope === state.scope &&
      missing.every((shot) => job.shots.get(shot.id) === JSON.stringify(shot)),
  );
  if (missing.length && covering) return covering;
  const job: IndexJob = {
    scope: state.scope,
    shots: new Map(missing.map((shot) => [shot.id, JSON.stringify(shot)])),
    cancelled: false,
    listeners: new Set(),
    promise: Promise.resolve("ready"),
  };
  if (!missing.length) return job;
  indexJobs.set(state.indexKey, job);
  const notify = () => {
    for (const listener of job.listeners) listener();
  };
  const taskId = `storyboard-semantic-index:${crypto.randomUUID()}`;
  job.promise = (async () => {
    const task = await createTaskProgress({
      operation: "storyboard.semanticIndex",
      resourceKey: state.scope,
      label: "正在构建分镜索引...",
      current: 0,
      total: 1,
      on_cancel: async () => {
        // A false return means cancellation preceded native registration.
        // Its initial progress message will retry cancellation in that case.
        await invokeCommand("cancel_task", { taskId });
        job.cancelled = true;
        notify();
      },
    });
    try {
      if (task.cancelled) {
        job.cancelled = true;
        notify();
        return "cancelled" as const;
      }
      const onProgress = new Channel<SemanticProgress>((progress) => {
        if (job.cancelled || task.cancelled) {
          void runOperation("task.cancel", () => invokeCommand("cancel_task", { taskId }));
          return;
        }
        task.update({
          label: `正在构建 ${progress.total} 条分镜索引...`,
          current: progress.total ? progress.completed / progress.total : 0,
        });
      });
      await invokeCommand("select_storyboard_frames", {
        shots: missing,
        taskId,
        onProgress,
      });
      if (job.cancelled || task.cancelled) return "cancelled" as const;
      const current = indexedShots.get(state.scope) ?? new Map<string, string>();
      for (const shot of missing) current.set(shot.id, JSON.stringify(shot));
      indexedShots.set(state.scope, current);
      return "ready" as const;
    } catch (error) {
      if (job.cancelled || task.cancelled) return "cancelled" as const;
      task.fail(error, { resourceKind: "media" });
      return "failed" as const;
    } finally {
      task.remove();
      indexJobs.delete(state.indexKey);
    }
  })();
  return job;
}

// Graph and search consumers share native indexing work and its cancellation task.
export function ensureStoryboardSemanticIndex(shots: readonly SemanticShot[], scope: string) {
  return indexShots({ shots, scope, indexKey: JSON.stringify([scope, shots]) }).promise;
}

export function useStoryboardSemanticSearch(
  enabled: boolean,
  query: string,
  shots: readonly SemanticShot[],
  scope: string,
  clearQuery: () => void,
  negativePrompts = "",
) {
  const indexKey = useMemo(() => JSON.stringify([scope, shots]), [scope, shots]);
  const requestKey = useMemo(
    () =>
      enabled &&
      query.trim() &&
      shots.length &&
      !Object.keys(semanticPromptErrors(query, negativePrompts)).length
        ? JSON.stringify([indexKey, query, negativePrompts])
        : "",
    [enabled, query, negativePrompts, indexKey, shots.length],
  );
  const latest = useRef<SearchState>({
    negativePrompts,
    enabled,
    query,
    scope,
    shots,
    indexKey,
    requestKey,
    clearQuery,
  });
  latest.current = {
    negativePrompts,
    enabled,
    query,
    scope,
    shots,
    indexKey,
    requestKey,
    clearQuery,
  };
  const mounted = useRef(true);
  const busy = useRef(false);
  const indexed = useRef(new Set<string>());
  const cancelledRequest = useRef<string | null>(null);
  const completedRequest = useRef<string | null>(null);
  const version = useRef(0);
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const reusable = useMemo(() => {
    if (
      !requestKey ||
      !result ||
      result.status !== "ready" ||
      result.key === requestKey ||
      !canReuseSearch(result.input, { scope, shots, query, negativePrompts })
    )
      return null;
    const ids = new Set(shots.map((shot) => shot.id));
    return {
      ...result,
      key: requestKey,
      scores: new Map([...result.scores].filter(([id]) => ids.has(id))),
      frames: new Map([...result.frames].filter(([id]) => ids.has(id))),
    };
  }, [requestKey, result, scope, query, negativePrompts, shots]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (reusable) {
      completedRequest.current = requestKey;
      return;
    }
    if (cancelledRequest.current !== requestKey) cancelledRequest.current = null;
    if (
      !requestKey ||
      busy.current ||
      completedRequest.current === requestKey ||
      cancelledRequest.current === requestKey
    )
      return;
    const timer = window.setTimeout(() => {
      busy.current = true;
      void (async () => {
        const start = latest.current;
        try {
          if (!start.requestKey) return;
          if (!indexed.current.has(start.indexKey)) {
            const job = indexShots(start);
            const onUpdate = () => {
              if (!mounted.current) return;
              const current = latest.current;
              if (
                job.cancelled &&
                current.scope === job.scope &&
                current.indexKey === start.indexKey &&
                current.query === start.query
              ) {
                cancelledRequest.current = current.requestKey;
                current.clearQuery();
              }
            };
            job.listeners.add(onUpdate);
            onUpdate();
            let outcome: Awaited<IndexJob["promise"]>;
            try {
              outcome = await job.promise;
            } finally {
              job.listeners.delete(onUpdate);
            }
            if (!mounted.current) return;
            if (outcome === "ready") indexed.current.add(start.indexKey);
            if (outcome === "failed") {
              if (latest.current.indexKey === start.indexKey && latest.current.requestKey) {
                completedRequest.current = latest.current.requestKey;
                setResult({
                  input: latest.current,
                  key: latest.current.requestKey,
                  scores: emptyScores,
                  frames: emptyScores,
                  status: "failed",
                  version: version.current,
                });
              }
              return;
            }
            if (outcome === "cancelled") return;
          }
          // Read the panel now: query changes during indexing are intentionally
          // accepted. A different scope is handled by the next pump iteration.
          const current = latest.current;
          if (
            !mounted.current ||
            !current.requestKey ||
            current.scope !== start.scope ||
            !containsSemanticShots(start.shots, current.shots)
          )
            return;
          const stillCurrent = () =>
            mounted.current &&
            Boolean(latest.current.requestKey) &&
            canReuseSearch(current, latest.current);
          const outcome = await runOperation("storyboard.semanticSearch", async () => {
            if (!(await initializeStoryboardSemanticSearch())) {
              if (stillCurrent()) cancelledRequest.current = latest.current.requestKey;
              return null;
            }
            if (!stillCurrent()) return null;
            return searchSemanticPrompts(
              searchLines(searchQueryToMultiline(current.query, "semantic")),
              searchLines(current.negativePrompts),
              (query) =>
                invokeCommand<SemanticMatch[]>("search_storyboards_semantic", {
                  query,
                  shots: current.shots,
                }),
              stillCurrent,
              (queries) =>
                invokeCommand<SemanticMatch[][]>("search_storyboards_semantic_batch", {
                  queries,
                  shots: current.shots,
                }),
            );
          });
          if (!stillCurrent()) return;
          if (outcome.status === "success" && outcome.value === null) return;
          completedRequest.current = latest.current.requestKey;
          if (outcome.status === "success" && outcome.value !== null) {
            setResult({
              input: current,
              key: current.requestKey,
              scores: new Map(outcome.value.map((match) => [match.id, match.similarity])),
              frames: new Map(outcome.value.map((match) => [match.id, match.frame])),
              status: "ready",
              version: ++version.current,
            });
          } else if (outcome.status === "failed") {
            setResult({
              input: latest.current,
              key: latest.current.requestKey,
              scores: emptyScores,
              frames: emptyScores,
              status: "failed",
              version: version.current,
            });
          }
        } finally {
          busy.current = false;
          if (mounted.current) setTick((value) => value + 1);
        }
      })();
    }, 350);
    // Only the debounce is tied to view changes. A started index keeps its
    // background task and queue slot until native work settles.
    return () => window.clearTimeout(timer);
  }, [requestKey, tick, reusable]);

  const current = requestKey && result?.key === requestKey ? result : reusable;
  return {
    scores: current?.scores ?? emptyScores,
    frames: current?.frames ?? emptyScores,
    status: !requestKey ? "idle" : (current?.status ?? "pending"),
    resultVersion: current?.version ?? 0,
    retry: () => {
      for (const shot of shots) indexedShots.get(scope)?.delete(shot.id);
      indexed.current.delete(indexKey);
      completedRequest.current = null;
      cancelledRequest.current = null;
      setResult(null);
      setTick((value) => value + 1);
    },
  };
}
