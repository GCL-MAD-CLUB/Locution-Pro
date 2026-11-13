import { createModuleLoader, deferred, flush } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExportClip,
  ExportMode,
  ExportSettings,
} from "../../../src/systems/ExportSystem/exportTypes.ts";
import type { ExportTaskSubmission } from "../../../src/systems/ExportSystem/exportTask.ts";

type ExportTaskModule = typeof import("../../../src/systems/ExportSystem/exportTask.ts");
type ExportActionBarModule =
  typeof import("../../../src/components/panels/ExportWorkspace/controls/ExportActionBar.tsx");
type HarnessCall = [name: string, payload?: unknown];

interface TaskHarnessOptions {
  mode?: ExportMode;
  uniqueName?: string | null;
  progressCancelled?: boolean;
}

interface HarnessScenario {
  name: string;
  action: "cancel" | "skip" | "uniqueName";
  mode?: ExportMode;
  uniqueName?: string | null;
  conflicts?: string[];
}

const loadModule = createModuleLoader(import.meta.url);

function taskHarness({
  mode = "individual",
  uniqueName = "new.mp4",
  progressCancelled = false,
}: TaskHarnessOptions = {}) {
  const calls: HarnessCall[] = [];
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
    activeEventId: null as string | null,
    append: () => {},
    updateStatus: (_id: string, status: string) => calls.push(["status", status]),
  };
  const module = loadModule<ExportTaskModule>("../../../src/systems/ExportSystem/exportTask.ts", {
    "../../errors": {
      captureOperationError: () => calls.push(["error"]),
      invokeCommand: (command: string, args: unknown) => {
        calls.push([command, args]);
        return backend.promise;
      },
    },
    "../../errors/runtime": { normalizeError: (error: unknown) => error },
    "../../platform/tauri/ffmpegProgress": {
      createFfmpegTaskId: () => "export-task",
      listenToFfmpegTaskProgress: () => () => {},
      cancelFfmpegTask: async () => calls.push(["cancel-backend"]),
    },
    "../TaskSystem": {
      createTaskProgress: async (options: { label: string }) => {
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
      computeExportFileNames: (clips: ReadonlyArray<{ id: string }>) =>
        clips.map((clip) => ({ clipId: clip.id, fileName: clip.id })),
    },
    "./exportQueueState": { exportQueueStore: { getState: () => queue } },
    "./exportConflict": {
      buildExportTargets: (clips: unknown) => clips,
      findExistingTargets: () => scan.promise,
      filterConflictingClips: (
        clips: ReadonlyArray<{ id: string }>,
        conflicts: ReadonlyArray<{ clipId: string | null }>,
      ) => clips.filter((clip) => !conflicts.some((conflict) => conflict.clipId === clip.id)),
      resolveUniqueFileName: async () => uniqueName,
    },
    "./exportConflictDialogState": {
      requestExportConflictAction: () => {
        calls.push(["conflict"]);
        return choice.promise;
      },
    },
  });
  const submission: ExportTaskSubmission = module.enqueueExportTask({
    clips: ["a", "b"].map((id) => ({
      id,
      audioSources: [] as ExportClip["audioSources"],
      sourcePath: `${id}.mp4`,
    })) as ExportClip[],
    settings: {
      destination: "specified",
      outputDir: "D:/exports",
      mode,
      existingFileMode: "ask",
    } as ExportSettings,
    audioBindingsAlreadyRefreshed: true,
    projectId: null,
  });
  return { calls, scan, choice, backend, submission };
}

test("conflict checks and decisions precede progress registration and export start", async () => {
  const h = taskHarness();
  let started: boolean | undefined;
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

const scenarios: HarnessScenario[] = [
  { name: "cancel", action: "cancel" },
  { name: "skip every individual output", action: "skip", conflicts: ["a", "b"] },
  { name: "skip merged output", action: "skip", mode: "merge" },
  { name: "exhaust unique names", action: "uniqueName", uniqueName: null },
];

for (const scenario of scenarios) {
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
  const progressOptions = h.calls.find(([name]) => name === "progress")![1] as {
    label: string;
  };
  assert.equal(progressOptions.label, "正在导出 1 个片段...");
  const exportArguments = h.calls.find(([name]) => name === "export_clips")![1] as {
    clips: ReadonlyArray<{ id: string }>;
  };
  assert.deepEqual(
    Array.from(exportArguments.clips, (clip) => clip.id),
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

interface RenderedNode {
  type: unknown;
  props: {
    children?: RenderedNode;
    onClick?: () => void;
  };
}

function actionBarHarness() {
  const start = deferred<boolean>();
  const completion = deferred<unknown>();
  const calls: string[] = [];
  const messages: string[] = [];
  let projectId: string | null = null;
  const source = { clips: [{ id: "a" }] };
  const state = {
    source,
    selectedClipIds: new Set(["a"]),
    settings: { outputDir: "D:/exports", outputStem: "output" },
    setResults: (_results: unknown) => {},
    setStatus: (_status: string) => {},
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const { ExportActionBar } = loadModule<ExportActionBarModule>(
    "../../../src/components/panels/ExportWorkspace/controls/ExportActionBar.tsx",
    {
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: { useState: () => [false, () => {}] },
      "lucide-react": { FolderOpen: () => null },
      "../../../../errors": {},
      "../../../../systems/ExportSystem": {
        useExportWorkspaceState: (selector: (workspace: typeof state) => unknown) =>
          selector(state),
        exportWorkspaceStore: { getState: () => state },
        enqueueExportTask: () => ({ started: start.promise, completion: completion.promise }),
      },
      "../../../../systems/ProjectSystem": {
        useProjectPort: () => ({
          projectId,
          messagePublished: (message: string) => messages.push(message),
          exportSettingsRecorded: () => {},
        }),
        getProjectExportContext: () => ({ projectId }),
      },
    },
  );
  const view = ExportActionBar({
    onExportStarted: () => calls.push("edit"),
  }) as RenderedNode;
  view.props.children!.props.children!.props.onClick!();
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

const completionOutcomes: Array<[unknown, string]> = [
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
];

for (const [outcome, expected] of completionOutcomes) {
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
