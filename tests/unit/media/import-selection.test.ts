import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createModuleLoader, deferred, flush } from "../support/module-loader.ts";
import { clientError } from "../../../src/errors/model.ts";
import * as model from "../../../src/components/panels/ImportWorkspace/browser/importBrowserModel.ts";
import type {
  ImportDirectory,
  ImportEntry,
} from "../../../src/components/panels/ImportWorkspace/browser/importBrowserModel.ts";
import type { ImportSelectionItem } from "../../../src/components/panels/ImportWorkspace/browser/importFolderScan.ts";

type ThemeModule = typeof import("../../../src/runtime/theme.ts");
type ImportFolderScanModule =
  typeof import("../../../src/components/panels/ImportWorkspace/browser/importFolderScan.ts");
type ImportSelectionModule =
  typeof import("../../../src/components/panels/ImportWorkspace/selection/importSelection.ts");
type MediaImportTaskModule = typeof import("../../../src/application/media/mediaImportTask.ts");

const load = createModuleLoader(import.meta.url);
const theme = load<ThemeModule>("../../../src/runtime/theme.ts", {
  "../styles.css?raw": readFileSync(new URL("../../../src/styles.css", import.meta.url), "utf8"),
  "../errors/model": { clientError },
});
const scan = load<ImportFolderScanModule>(
  "../../../src/components/panels/ImportWorkspace/browser/importFolderScan.ts",
  { "./importBrowserModel": model },
  { setTimeout },
);
const entry = (path: string, is_directory = false): ImportEntry => ({
  path,
  name: path.split(/[\\/]/).pop() ?? "",
  is_directory,
  is_hidden: false,
  size: 1,
  created_at: null,
});
const listing = (
  directory: string,
  entries: ImportEntry[],
  canonical_path = directory,
): ImportDirectory => ({
  directory,
  canonical_path,
  parent: null,
  entries,
});

test("recursive scan follows nested media, rejects unsupported files and terminates canonical cycles", async () => {
  const directories: Record<string, ImportDirectory> = {
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
  const reads: string[] = [];
  const updates: { files: ImportEntry[]; unreadable: string[] }[] = [];
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
    Array.from(updates.at(-1)!.files, (file) => file.path),
    ["C:/root/a.MP4", "C:/root/nested/b.wav"],
  );
  assert.equal(updates.at(-1)!.unreadable.length, 0);
});

test("unreadable folder is explicit while readable siblings survive for retry", async () => {
  const updates: { files: ImportEntry[]; unreadable: string[] }[] = [];
  await scan.scanImportFolder(
    "/root",
    async (path) =>
      path === "/root" ? listing(path, [entry("/root/a.srt"), entry("/root/denied", true)]) : null,
    new AbortController().signal,
    (files, unreadable) => updates.push({ files, unreadable }),
  );
  assert.deepEqual(Array.from(updates.at(-1)!.unreadable), ["/root/denied"]);
  assert.equal(updates.at(-1)!.files[0].path, "/root/a.srt");
});

test("cancelled scans ignore in-flight listings and never publish late results", async () => {
  const controller = new AbortController(),
    read = deferred<ImportDirectory | null>();
  const updates: [ImportEntry[], string[]][] = [];
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
  const items = [{ files: [a, b] }, { files: [alias] }] as ImportSelectionItem[];
  const before = structuredClone(items);
  const files = scan.collectSelectionFiles(items, new Set([model.pathKey(b.path)]));
  assert.equal(files.length, 1);
  assert.equal(model.pathKey(files[0].path), model.pathKey(a.path));
  assert.deepEqual(items, before);
});

interface RegistrationOptions {
  failPath?: string;
  cancelled?: boolean;
  hold?: boolean;
}

interface ImportInvokeArgs {
  path: string;
  directory?: string;
  verify?: boolean;
  taskId: string;
  assetId?: string | null;
}

interface SelectionCall {
  command: string;
  args: ImportInvokeArgs;
}

type VoidDeferred = ReturnType<typeof deferred<void>>;

function registration({ failPath, cancelled = false, hold = false }: RegistrationOptions = {}) {
  const calls: SelectionCall[] = [];
  const pending: VoidDeferred[] = [];
  let active = 0,
    peak = 0;
  const module = load<ImportSelectionModule>(
    "../../../src/components/panels/ImportWorkspace/selection/importSelection.ts",
    {
      "../../../../runtime/theme": theme,
      "../browser/importBrowserModel": model,
      "../../../../platform/tauri/ffmpegProgress": { createFfmpegTaskId: () => "task" },
      "../../../../errors": {
        invokeCommand: async (command: string, args: ImportInvokeArgs): Promise<unknown> => {
          calls.push({ command, args });
          if (args.path === failPath) throw new Error("registration failed");
          if (command === "copy_import_media")
            return `${args.directory}/${args.path.split("/").pop()}`;
          active++;
          peak = Math.max(peak, active);
          if (hold) {
            const job = deferred<void>();
            pending.push(job);
            await job.promise;
          }
          active--;
          return { project: { asset: { id: args.path } }, warnings: [] };
        },
        runOperation: async (
          _operation: string,
          action: () => Promise<unknown>,
        ): Promise<unknown> => {
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
  assert.equal(result.subtitles[0].color, "#893a04");
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

interface BatchFailureContext {
  displayName: string;
  count?: number;
}

interface BatchFailureReport {
  error: unknown;
  context: BatchFailureContext;
}

interface BatchImportInvokeArgs {
  path: string;
  taskId: string;
  assetId: string | null;
}

const failureCases: [string[], string][] = [
  [["C:\\media\\failed.mkv"], "failed.mkv"],
  [["C:\\media\\failed.mkv", "C:\\media\\also-failed.mp4"], "2 个媒体"],
];

for (const [failed, displayName] of failureCases) {
  test(`batch import failure identifies ${displayName} in the error context`, async () => {
    const reports: BatchFailureReport[] = [];
    const { runMediaImportBatchTask } = load<MediaImportTaskModule>(
      "../../../src/application/media/mediaImportTask.ts",
      {
        "../../systems/TaskSystem": {
          createTaskProgress: async () => ({
            cancelled: false,
            fail: (error: unknown, context: BatchFailureContext) =>
              reports.push({ error, context }),
          }),
        },
        "../../errors": {
          clientError,
          invokeCommand: async (_command: string, { path }: BatchImportInvokeArgs) => {
            if (failed.includes(path)) throw new Error("import failed");
            return { path };
          },
        },
        "../../platform/tauri/ffmpegProgress": {
          createFfmpegTaskId: () => "import-task",
          listenToFfmpegTasksProgress: () => () => {},
        },
      },
    );
    const result = await runMediaImportBatchTask({
      paths: [...failed, "C:\\media\\good.mp4"],
      operation: "media.import",
      taskIdPrefix: "import",
    });
    assert.equal(result.status, "partial");
    assert.equal(result.results.length, 1);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].context.displayName, displayName);
    assert.equal(reports[0].context.count, failed.length);
  });
}
