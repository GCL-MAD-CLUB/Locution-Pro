import { createModuleLoader } from "../support/module-loader.ts";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const loadModule = createModuleLoader(import.meta.url);
const modulePath = "../../../src/runtime/mediaSources.ts";

test("native requests follow relink, undo, deletion and document replacement without synchronization", () => {
  const { registerMediaSources, commandMediaSources } = loadModule(modulePath);
  const original = { asset: { id: "a", path: "original.mp4" }, cues: {} };
  const relinked = { ...original, asset: { ...original.asset, path: "relinked.mp4" } };
  let sources = { a: original };
  registerMediaSources(() => sources);
  const request = () => commandMediaSources("detect_storyboard_shots", { assetId: "a" });
  const inFlight = request();
  sources = { a: relinked };
  assert.equal(request().mediaSources.a.asset.path, "relinked.mp4");
  assert.equal(inFlight.mediaSources.a.asset.path, "original.mp4");
  sources = { a: original };
  assert.equal(request().mediaSources.a.asset.path, original.asset.path);
  sources = {};
  assert.equal(request().mediaSources.a, undefined);
  sources = { b: { asset: { id: "b", path: "other.mp4" } } };
  assert.equal(request().mediaSources.a, undefined);
});

test("batch operations include exactly their requested media and override supplied mirrors", () => {
  const { registerMediaSources, commandMediaSources } = loadModule(modulePath);
  const a = { asset: { id: "a" } },
    b = { asset: { id: "b" } };
  registerMediaSources(() => ({ a, b }));
  const batch = commandMediaSources("find_media_needing_analysis", { assetIds: ["a", "missing"] });
  assert.deepEqual(Object.keys(batch.mediaSources), ["a"]);
  const search = commandMediaSources("search_storyboards_semantic_batch", {
    shots: [{ assetId: "b" }, { assetId: "b" }],
    mediaSources: { a },
  });
  assert.deepEqual(Object.keys(search.mediaSources), ["b"]);
  assert.equal(search.mediaSources.b.asset, b.asset);
  const args = { clips: [] };
  assert.equal(commandMediaSources("export_clips", args), args);
});

test("storyboard indexing, retrieval and graph requests include shot media", () => {
  const { registerMediaSources, commandMediaSources } = loadModule(modulePath);
  const media = { asset: { id: "a", path: "source.mp4" } };
  registerMediaSources(() => ({ a: media, unrelated: { asset: { id: "unrelated" } } }));
  for (const command of [
    "select_storyboard_frames",
    "search_storyboards_semantic",
    "search_storyboards_semantic_batch",
    "read_storyboard_graph_vectors",
  ]) {
    const request = commandMediaSources(command, { shots: [{ assetId: "a" }] });
    assert.deepEqual(Object.keys(request.mediaSources), ["a"], command);
    assert.equal(request.mediaSources.a.asset.path, "source.mp4", command);
  }
});

test("every native media input command receives document sources at the IPC boundary", () => {
  const { registerMediaSources, commandMediaSources } = loadModule(modulePath);
  registerMediaSources(() => ({ a: { asset: { id: "a" } } }));
  const backend = new URL("../../../src-tauri/src/backend/", import.meta.url);
  let count = 0;
  for (const entry of readdirSync(backend, { recursive: true }).filter((name) =>
    name.endsWith(".rs"),
  )) {
    const source = readFileSync(new URL(entry.replaceAll("\\", "/"), backend), "utf8");
    for (const match of source.matchAll(
      /#\[tauri::command\]\s+pub\(crate\) (?:async )?fn (\w+)\(([^)]*)\)/g,
    )) {
      if (!match[2].includes("media_sources:")) continue;
      const signature = match[2];
      const args = /\bshots:/.test(signature)
        ? { shots: [{ assetId: "a" }] }
        : /\basset_ids:/.test(signature)
          ? { assetIds: ["a"] }
          : /\basset_id:/.test(signature)
            ? { assetId: "a" }
            : null;
      assert.ok(args, `Unrecognized media selector for ${match[1]}`);
      assert.ok(commandMediaSources(match[1], args).mediaSources?.a, match[1]);
      count++;
    }
  }
  assert.equal(count, 19);
});

test("the real storyboard index dispatch includes current document media", async () => {
  const { registerMediaSources, commandMediaSources } = loadModule(modulePath);
  const media = { asset: { id: "a", path: "relinked.mp4" } };
  registerMediaSources(() => ({ a: media }));
  const requests = [];
  const failures = [];
  const { ensureStoryboardSemanticIndex } = loadModule(
    "../../../src/application/media/storyboardSemanticSearch.ts",
    {
      "../../core/editor/semanticPrompts": {},
      "../../core/editor/textSearch": {},
      "@tauri-apps/api/core": { Channel: class {} },
      react: {},
      "../../errors": {
        invokeCommand: async (command, args) => {
          const request = commandMediaSources(command, args);
          requests.push({ command, request });
          for (const shot of request.shots) {
            assert.equal(request.mediaSources[shot.assetId]?.asset.path, "relinked.mp4");
          }
        },
      },
      "../../errors/runtime": {},
      "../../systems/TaskSystem": {
        createTaskProgress: async () => ({
          cancelled: false,
          fail: (error) => failures.push(error),
          remove() {},
        }),
      },
      "../../platform/tauri/runtime": {},
    },
    { crypto: globalThis.crypto },
  );
  const shot = {
    id: "shot",
    assetId: "a",
    fingerprint: "hash",
    startFrame: 0,
    endFrame: 24,
    source: "detected",
  };
  assert.equal(await ensureStoryboardSemanticIndex([shot], "scope"), "ready");
  assert.equal(failures.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].command, "select_storyboard_frames");
  assert.equal(requests[0].request.shots[0], shot);
});

test("metadata operations omit cue payloads while analysis preserves them", () => {
  const { registerMediaSources, commandMediaSources } = loadModule(modulePath);
  const cues = { t: [{ plain_text: "edited" }] },
    tracks = [{ id: "t" }];
  registerMediaSources(() => ({ a: { asset: { id: "a" }, cues, tracks } }));
  const args = { assetId: "a" };
  const thumbnail = commandMediaSources("generate_storyboard_thumbnails", args).mediaSources.a;
  assert.equal(Object.keys(thumbnail.cues).length, 0);
  assert.equal(thumbnail.tracks.length, 0);
  const analysis = commandMediaSources("analyze_imported_media", args).mediaSources.a;
  assert.equal(analysis.cues, cues);
  assert.equal(analysis.tracks, tracks);
});
