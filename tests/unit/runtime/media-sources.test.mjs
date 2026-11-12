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
    shots: [{ asset_id: "b" }, { asset_id: "b" }],
    mediaSources: { a },
  });
  assert.deepEqual(Object.keys(search.mediaSources), ["b"]);
  assert.equal(search.mediaSources.b.asset, b.asset);
  const args = { clips: [] };
  assert.equal(commandMediaSources("export_clips", args), args);
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
      assert.ok(commandMediaSources(match[1], { assetId: "a" }).mediaSources?.a, match[1]);
      count++;
    }
  }
  assert.equal(count, 19);
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
