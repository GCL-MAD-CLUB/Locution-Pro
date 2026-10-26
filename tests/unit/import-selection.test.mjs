import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader, deferred, flush } from "./support/module-loader.ts";
import * as model from "../../src/components/panels/ImportWorkspace/browser/importBrowserModel.ts";

const load = createModuleLoader(import.meta.url);
const scan = load(
  "../../src/components/panels/ImportWorkspace/browser/importFolderScan.ts",
  { "./importBrowserModel": model },
  { setTimeout },
);
const entry = (path, is_directory = false) => ({
  path,
  name: path.split(/[\\/]/).pop(),
  is_directory,
  is_hidden: false,
  size: 1,
  created_at: null,
});
const listing = (directory, entries, canonical_path = directory) => ({
  directory,
  canonical_path,
  parent: null,
  entries,
});

test("recursive scan follows nested media, rejects unsupported files and terminates canonical cycles", async () => {
  const directories = {
    "C:/root": listing("C:/root", [
      entry("C:/root/a.MP4"),
      entry("C:/root/nested", true),
      entry("C:/root/notes.txt"),
    ]),
    "C:/root/nested": listing("C:/root/nested", [
      entry("C:/root/nested/b.wav"),
      entry("C:/root/nested/alias", true),
    ]),
    "C:/root/nested/alias": listing(
      "C:/root/nested/alias",
      [entry("C:/root/nested/alias/loop", true)],
      "c:\\ROOT",
    ),
  };
  const reads = [],
    updates = [];
  await scan.scanImportFolder(
    "C:/root",
    async (path) => {
      reads.push(path);
      return directories[path];
    },
    new AbortController().signal,
    (files, unreadable) => updates.push({ files, unreadable }),
  );
  assert.deepEqual(reads, Object.keys(directories));
  assert.deepEqual(
    Array.from(updates.at(-1).files, (file) => file.path),
    ["C:/root/a.MP4", "C:/root/nested/b.wav"],
  );
  assert.equal(updates.at(-1).unreadable.length, 0);
});

test("unreadable folder is explicit while readable siblings survive for retry", async () => {
  const updates = [];
  await scan.scanImportFolder(
    "/root",
    async (path) =>
      path === "/root" ? listing(path, [entry("/root/a.srt"), entry("/root/denied", true)]) : null,
    new AbortController().signal,
    (files, unreadable) => updates.push({ files, unreadable }),
  );
  assert.deepEqual(Array.from(updates.at(-1).unreadable), ["/root/denied"]);
  assert.equal(updates.at(-1).files[0].path, "/root/a.srt");
});

test("cancelled scans ignore in-flight listings and never publish late results", async () => {
  const controller = new AbortController(),
    read = deferred();
  const updates = [];
  const pending = scan.scanImportFolder(
    "/root",
    () => read.promise,
    controller.signal,
    (...args) => updates.push(args),
  );
  controller.abort();
  read.resolve(listing("/root", [entry("/root/late.mp4")]));
  await pending;
  assert.deepEqual(updates, []);
});

test("overlapping selections deduplicate Windows aliases and exclude previously imported files", () => {
  const a = entry("C:/root/a.mp4"),
    alias = entry("c:\\ROOT\\A.MP4"),
    b = entry("C:/root/b.wav");
  const items = [{ files: [a, b] }, { files: [alias] }];
  const before = structuredClone(items);
  const files = scan.collectSelectionFiles(items, new Set([model.pathKey(b.path)]));
  assert.equal(files.length, 1);
  assert.equal(model.pathKey(files[0].path), model.pathKey(a.path));
  assert.deepEqual(items, before);
});

function registration({ failPath, cancelled = false, hold = false } = {}) {
  const calls = [],
    pending = [];
  let active = 0,
    peak = 0;
  const module = load(
    "../../src/components/panels/ImportWorkspace/selection/importSelection.ts",
    {
      "../browser/importBrowserModel": model,
      "../../../../platform/tauri/ffmpegProgress": { createFfmpegTaskId: () => "task" },
      "../../../../errors": {
        invokeCommand: async (command, args) => {
          calls.push({ command, args });
          if (args.path === failPath) throw new Error("registration failed");
          if (command === "copy_import_media")
            return `${args.directory}/${args.path.split("/").pop()}`;
          active++;
          peak = Math.max(peak, active);
          if (hold) {
            const job = deferred();
            pending.push(job);
            await job.promise;
          }
          active--;
          return { project: { asset: { id: args.path } }, warnings: [] };
        },
        runOperation: async (_, action) => {
          if (cancelled) return { status: "cancelled" };
          try {
            return { status: "success", value: await action() };
          } catch {
            return { status: "error" };
          }
        },
      },
    },
    { crypto },
  );
  return { ...module, calls, pending, peak: () => peak };
}

test("registration imports mixed media while subtitle files bypass native registration", async () => {
  const api = registration();
  const result = await api.registerImportSelection(
    [entry("/a.mp4"), entry("/b.WAV"), entry("/c.SRT")],
    null,
  );
  assert.equal(result.results.length, 2);
  assert.equal(result.subtitles[0].kind, "subtitle");
  assert.equal(result.subtitles[0].codec, "srt");
  assert.equal(result.completed.size, 3);
  assert.equal(api.calls.length, 2);
});

test("copy succeeds before registration and passes the chosen verification contract", async () => {
  const api = registration();
  const result = await api.registerImportSelection([entry("/a.mp4")], {
    directory: "/copy",
    verify: true,
  });
  assert.deepEqual(
    api.calls.map((call) => call.command),
    ["copy_import_media", "register_import_media"],
  );
  assert.equal(api.calls[0].args.verify, true);
  assert.equal(api.calls[1].args.path, "/copy/a.mp4");
  assert.deepEqual(Array.from(result.completed), ["/a.mp4"]);
});

test("partial failures and failed copies remain incomplete without discarding successful siblings", async () => {
  for (const copy of [null, { directory: "/copy", verify: false }]) {
    const api = registration({ failPath: "/bad.mp4" });
    const result = await api.registerImportSelection([entry("/bad.mp4"), entry("/good.wav")], copy);
    assert.deepEqual(Array.from(result.completed), ["/good.wav"]);
    assert.equal(result.results.length, 1);
    assert.equal(
      api.calls.some(
        (call) => call.command === "register_import_media" && call.args.path.endsWith("bad.mp4"),
      ),
      !copy,
    );
  }
});

test("registration runs at most three native jobs and drains all remaining work", async () => {
  const api = registration({ hold: true });
  const run = api.registerImportSelection(
    Array.from({ length: 8 }, (_, i) => entry(`/clip-${i}.mp4`)),
    null,
  );
  await flush();
  assert.equal(api.pending.length, 3);
  for (let i = 0; i < 8; i++) {
    api.pending[i].resolve();
    await flush();
  }
  assert.equal((await run).completed.size, 8);
  assert.equal(api.peak(), 3);
});

test("cancelled registration dispatches no copy or import", async () => {
  const api = registration({ cancelled: true });
  const result = await api.registerImportSelection([entry("/a.mp4")], {
    directory: "/copy",
    verify: true,
  });
  assert.deepEqual(api.calls, []);
  assert.equal(result.completed.size, 0);
});
