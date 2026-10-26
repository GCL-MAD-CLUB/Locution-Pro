import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadModule(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function taskHarness({
  mode = "individual",
  uniqueName = "new.mp4",
  progressCancelled = false,
} = {}) {
  const calls = [];
  const scan = deferred();
  const choice = deferred();
  const backend = deferred();
  const progress = {
    cancelled: progressCancelled,
    remove: () => calls.push(["remove"]),
    fail: () => calls.push(["fail"]),
  };
  const queue = {
    queuedCount: 0,
    activeEventId: null,
    append: () => {},
    updateStatus: (_, status) => calls.push(["status", status]),
  };
  const module = loadModule("../../src/systems/ExportSystem/exportTask.ts", {
    "../../errors": {
      captureOperationError: () => calls.push(["error"]),
      invokeCommand: (command, args) => {
        calls.push([command, args]);
        return backend.promise;
      },
    },
    "../../errors/runtime": { normalizeError: (error) => error },
    "../../platform/tauri/ffmpegProgress": {
      createFfmpegTaskId: () => "export-task",
      listenToFfmpegTaskProgress: () => () => {},
      cancelFfmpegTask: async () => calls.push(["cancel-backend"]),
    },
    "../TaskSystem": {
      createTaskProgress: async (options) => {
        calls.push(["progress", options]);
        return progress;
      },
    },
    "../ProjectSystem": { getProjectExportContext: () => ({ projectId: null }) },
    "../../application/media/mediaImportTask": {},
    "./exportTypes": { isAudioOnlyContainer: () => false },
    "./exportResolvers": {},
    "./exportDestination": {},
    "./exportRename": {
      computeExportFileNames: (clips) =>
        clips.map((clip) => ({ clipId: clip.id, fileName: clip.id })),
    },
    "./exportQueueState": { exportQueueStore: { getState: () => queue } },
    "./exportConflict": {
      buildExportTargets: (clips) => clips,
      findExistingTargets: () => scan.promise,
      filterConflictingClips: (clips, conflicts) =>
        clips.filter((clip) => !conflicts.some((conflict) => conflict.clipId === clip.id)),
      resolveUniqueFileName: async () => uniqueName,
    },
    "./exportConflictDialogState": {
      requestExportConflictAction: () => {
        calls.push(["conflict"]);
        return choice.promise;
      },
    },
  });
  const submission = module.enqueueExportTask({
    clips: ["a", "b"].map((id) => ({ id, audioSources: [], sourcePath: `${id}.mp4` })),
    settings: { destination: "specified", outputDir: "D:/exports", mode, existingFileMode: "ask" },
    audioBindingsAlreadyRefreshed: true,
    projectId: null,
  });
  return { calls, scan, choice, backend, submission };
}

test("conflict checks and decisions precede progress registration and export start", async () => {
  const h = taskHarness();
  let started;
  void h.submission.started.then((value) => (started = value));
  await flush();
  assert.equal(started, undefined);
  assert.equal(h.calls.length, 0);
  h.scan.resolve([{ clipId: "a", fileName: "a" }]);
  await flush();
  assert.deepEqual(
    h.calls.map(([name]) => name),
    ["conflict"],
  );
  assert.equal(started, undefined);
  h.choice.resolve("overwrite");
  assert.equal(await h.submission.started, true);
  assert.deepEqual(
    h.calls.map(([name]) => name),
    ["conflict", "progress", "export_clips", "status"],
  );
  let completed = false;
  void h.submission.completion.then(() => (completed = true));
  await flush();
  assert.equal(completed, false);
  h.backend.resolve({ outputs: [] });
  assert.equal((await h.submission.completion).status, "success");
});

for (const scenario of [
  { name: "cancel", action: "cancel" },
  { name: "skip every individual output", action: "skip", conflicts: ["a", "b"] },
  { name: "skip merged output", action: "skip", mode: "merge" },
  { name: "exhaust unique names", action: "uniqueName", uniqueName: null },
]) {
  test(`${scenario.name} creates no progress and never starts export`, async () => {
    const h = taskHarness(scenario);
    h.scan.resolve((scenario.conflicts ?? ["a"]).map((clipId) => ({ clipId, fileName: clipId })));
    h.choice.resolve(scenario.action);
    assert.equal(await h.submission.started, false);
    assert.equal((await h.submission.completion).status, "cancelled");
    assert.ok(!h.calls.some(([name]) => name === "progress" || name === "export_clips"));
  });
}

test("preflight errors settle both promises without progress or export", async () => {
  const h = taskHarness();
  h.scan.reject(new Error("Cannot inspect destination"));
  assert.equal(await h.submission.started, false);
  assert.equal((await h.submission.completion).status, "failed");
  assert.ok(!h.calls.some(([name]) => name === "progress" || name === "export_clips"));
});

test("partial skip registers progress for only the remaining files", async () => {
  const h = taskHarness();
  h.scan.resolve([{ clipId: "a" }]);
  h.choice.resolve("skip");
  assert.equal(await h.submission.started, true);
  assert.equal(h.calls.find(([name]) => name === "progress")[1].label, "正在导出 1 个片段...");
  assert.deepEqual(
    Array.from(h.calls.find(([name]) => name === "export_clips")[1].clips, (clip) => clip.id),
    ["b"],
  );
  h.backend.resolve({ outputs: [] });
  await h.submission.completion;
});

test("cancellation while waiting for a task slot never dispatches export", async () => {
  const h = taskHarness({ progressCancelled: true });
  h.scan.resolve([]);
  assert.equal(await h.submission.started, false);
  assert.equal((await h.submission.completion).status, "cancelled");
  assert.ok(!h.calls.some(([name]) => name === "export_clips"));
});

function actionBarHarness() {
  const start = deferred();
  const completion = deferred();
  const calls = [];
  const messages = [];
  let projectId = null;
  const source = { clips: [{ id: "a" }] };
  const state = {
    source,
    selectedClipIds: new Set(["a"]),
    settings: { outputDir: "D:/exports", outputStem: "output" },
    setResults: () => {},
    setStatus: () => {},
  };
  const jsx = (type, props) => ({ type, props });
  const { ExportActionBar } = loadModule(
    "../../src/components/panels/ExportWorkspace/controls/ExportActionBar.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { useState: () => [false, () => {}] },
      "lucide-react": { FolderOpen: () => null },
      "../../../../errors": {},
      "../../../../systems/ExportSystem": {
        useExportWorkspaceState: (selector) => selector(state),
        exportWorkspaceStore: { getState: () => state },
        enqueueExportTask: () => ({ started: start.promise, completion: completion.promise }),
      },
      "../../../../systems/ProjectSystem": {
        useProjectPort: () => ({
          projectId,
          messagePublished: (message) => messages.push(message),
          exportSettingsRecorded: () => {},
        }),
        getProjectExportContext: () => ({ projectId }),
      },
    },
  );
  const view = ExportActionBar({ onExportStarted: () => calls.push("edit") });
  view.props.children.props.children.props.onClick();
  return {
    start,
    completion,
    calls,
    messages,
    state,
    switchProject: () => {
      projectId = "other";
    },
  };
}

for (const started of [true, false]) {
  test(`export workspace navigates only when started resolves true (${started})`, async () => {
    const { start, completion, calls } = actionBarHarness();
    await flush();
    assert.deepEqual(calls, []);
    start.resolve(started);
    await flush();
    assert.deepEqual(calls, started ? ["edit"] : []);
    completion.resolve({ status: "cancelled" });
    await flush();
    assert.deepEqual(calls, started ? ["edit"] : []);
  });
}

for (const [outcome, expected] of [
  [
    { status: "success", result: { outputs: [{ status: "completed" }, { status: "completed" }] } },
    "已导出 2 个片段。",
  ],
  [
    { status: "success", result: { outputs: [{ status: "completed" }, { status: "failed" }] } },
    "已导出 1 个片段，1 个失败。",
  ],
  [{ status: "cancelled" }, "已取消导出。"],
  [{ status: "failed" }, "导出失败。"],
]) {
  test(`export workspace replaces its start message with ${expected}`, async () => {
    const h = actionBarHarness();
    h.start.resolve(true);
    await flush();
    assert.deepEqual(h.messages, ["已开始导出。"]);
    assert.deepEqual(h.calls, ["edit"]);
    // Completion must remain visible after returning to edit or choosing another export source.
    h.state.source = { clips: [] };
    h.completion.resolve(outcome);
    await flush();
    assert.deepEqual(h.messages, ["已开始导出。", expected]);
  });
}

test("export completion does not replace messages in a different project", async () => {
  const h = actionBarHarness();
  h.start.resolve(true);
  await flush();
  h.switchProject();
  h.completion.resolve({ status: "success", result: { outputs: [{ status: "completed" }] } });
  await flush();
  assert.deepEqual(h.messages, ["已开始导出。"]);
});
