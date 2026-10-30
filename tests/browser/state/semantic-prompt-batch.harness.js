import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useSubtitleSemanticSearch } from "../../../src/application/media/subtitleSemanticSearch.ts";
import { useStoryboardSemanticSearch } from "../../../src/application/media/storyboardSemanticSearch.ts";

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
function check(value, message) {
  if (!value) throw new Error(message);
}
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await pause();
  }
  throw new Error("Timed out waiting for semantic batch");
}

export async function runSemanticPromptBatchTests(kind) {
  const previous = window.__TAURI_INTERNALS__;
  const calls = [];
  let hold = false;
  const pending = [];
  const batchCommand =
    kind === "subtitle" ? "search_subtitles_semantic_batch" : "search_storyboards_semantic_batch";
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: (command, args) => {
      calls.push({ command, args });
      if (command === batchCommand) {
        const result = args.queries.map((query, index) => [
          { id: "a", similarity: query === "rain" ? 0.2 : 0.8 - index * 0.1, frame: 10 + index },
        ]);
        if (hold) return new Promise((resolve) => pending.push(() => resolve(result)));
        return Promise.resolve(result);
      }
      if (command.startsWith("search_")) throw new Error("Unexpected single-prompt request");
      return Promise.resolve(null);
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let snapshot;
  let input = { query: "day | day || night", negativePrompts: "rain", scope: "batch-test" };
  const items =
    kind === "subtitle"
      ? [{ id: "a", text: "example", source: "test" }]
      : [
          {
            id: "a",
            assetId: "video",
            fingerprint: "test",
            startFrame: 0,
            endFrame: 100,
            source: "test",
          },
        ];
  function Harness() {
    const useSearch = kind === "subtitle" ? useSubtitleSemanticSearch : useStoryboardSemanticSearch;
    snapshot = useSearch(true, input.query, items, input.scope, () => {}, input.negativePrompts);
    return null;
  }
  const render = () => flushSync(() => root.render(React.createElement(Harness)));
  const change = (next) => {
    input = { ...input, ...next };
    render();
  };
  const batches = () => calls.filter((call) => call.command === batchCommand);
  try {
    render();
    await waitFor(() => snapshot?.status === "ready");
    check(batches().length === 1, "all prompts share one native batch call");
    check(
      JSON.stringify(batches()[0].args.queries) === JSON.stringify(["day", "night", "rain"]),
      "same-side duplicates are removed",
    );
    check(Math.abs(snapshot.scores.get("a") - 0.6) < 1e-8, "positive max minus negative max");
    if (kind === "storyboard")
      check(snapshot.frames.get("a") === 10, "winning positive frame survives batching");
    change({ negativePrompts: " day " });
    await pause(450);
    check(
      batches().length === 1 && snapshot.status === "idle",
      "cross-list duplicates block model calls",
    );
    change({ query: "a".repeat(1001), negativePrompts: "rain" });
    await pause(450);
    check(batches().length === 1, "oversized prompts do not call the model");
    hold = true;
    change({ query: "first\nsecond" });
    await waitFor(() => pending.length === 1);
    change({ query: "current\nother" });
    hold = false;
    pending.shift()();
    check(snapshot.scores.size === 0, "old batch scores are hidden immediately");
    await waitFor(() => snapshot.status === "ready");
    check(batches().length === 3, "current query replaces the stale batch once");
    check(batches().at(-1).args.queries[0] === "current", "current batch is published");
    const indexCommand =
      kind === "subtitle" ? "index_subtitles_semantic" : "select_storyboard_frames";
    check(
      calls.filter((call) => call.command === indexCommand).length === 1,
      "prompt edits preserve the existing index",
    );
    if (kind === "storyboard")
      check(
        calls.filter((call) => call.command === "initialize_storyboard_semantic_search").length ===
          1,
        "all batch searches share one initialization",
      );
    return true;
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    if (previous) window.__TAURI_INTERNALS__ = previous;
    else delete window.__TAURI_INTERNALS__;
  }
}
