import { createModuleLoader } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { StoryboardState } from "../../../src/types.ts";
import type { StillExportSettings } from "../../../src/application/media/stillExportTask.ts";

type StoryboardCutsModule = typeof import("../../../src/core/editor/storyboardCuts.ts");
type StillExportModule = typeof import("../../../src/application/media/stillExportTask.ts");

interface StillExportCommandArgs {
  assetId: string;
  taskId: string;
  options: {
    mediaName: string;
    timecode: string;
    frame: number;
    frameRate: number;
    name: string;
    automaticName: boolean;
    directory: string;
    format: string;
  };
}

type StillExportCall =
  string | { command?: string; args?: StillExportCommandArgs; importPath?: string };

interface MediaImportCallOptions {
  path: string;
  onSuccess: (result: unknown) => void;
}

const loadModule = createModuleLoader(import.meta.url);

const cuts = loadModule<StoryboardCutsModule>("../../../src/core/editor/storyboardCuts.ts", {
  "./storyboard": loadModule("../../../src/core/editor/storyboard.ts", {}),
  "./timeline": {
    frameToTimeUs: (frame: number, rate: number) => Math.round((frame / rate) * 1_000_000),
  },
});

test("toolbar and timeline cuts reject endpoints, existing cuts and deleted gaps", () => {
  const empty: StoryboardState = {
    shots: [],
    deletedShots: [],
    shotAnnotations: {},
    shotStacks: [],
    keywordNodes: [],
    recentKeywordIds: [],
  };
  for (const frame of [0, 100, 101, -1, 1.5])
    assert.equal(cuts.canAddStoryboardCut(empty, frame, 100), false);
  assert.equal(cuts.canAddStoryboardCut(undefined, 1, 100), true);
  assert.equal(cuts.canAddStoryboardCut(empty, 99, 100), true);
  const split = cuts.splitStoryboardShot(empty, 40, 25, "new", 100, 4_000_000);
  assert.equal(split.shots.length, 2);
  assert.equal(split.shots[1].start_frame, 40);
  assert.equal(split.shots[0].end_frame + 1, split.shots[1].start_frame);
  assert.equal(split.shots[0].end_us, split.shots[1].start_us);
  assert.equal(split.shots[1].end_us, 4_000_000);
  assert.equal(cuts.canAddStoryboardCut(split, 40, 100), false);
  assert.equal(cuts.canAddStoryboardCut(split, 41, 100), true);
  const deleted = { ...split, shots: [split.shots[0]], deletedShots: [split.shots[1]] };
  assert.equal(cuts.canAddStoryboardCut(deleted, 60, 100), false);
  assert.equal(cuts.canAddStoryboardCut({ ...empty, deletedShots: split.shots }, 60, 100), false);
});

interface TaskHarnessOptions {
  switchDuringExport?: boolean;
  switchDuringImport?: boolean;
  failure?: boolean;
  unsaved?: boolean;
}

function taskHarness({
  switchDuringExport = false,
  switchDuringImport = false,
  failure = false,
  unsaved = false,
}: TaskHarnessOptions = {}) {
  const calls: StillExportCall[] = [];
  let projectId = unsaved ? null : "project-a";
  const task = {
    cancelled: false,
    update: () => calls.push("update"),
    remove: () => calls.push("remove"),
    fail: () => calls.push("failed"),
  };
  const module = loadModule<StillExportModule>(
    "../../../src/application/media/stillExportTask.ts",
    {
      "../../errors": {
        invokeCommand: async (command: string, args: StillExportCommandArgs): Promise<string> => {
          calls.push({ command, args });
          if (failure) throw new Error("offline original");
          if (switchDuringExport) projectId = "project-b";
          return "/output/still.png";
        },
      },
      "../../errors/runtime": { normalizeError: (error: unknown) => error },
      "../../platform/tauri/ffmpegProgress": {
        cancelFfmpegTask: async () => {},
        createFfmpegTaskId: () => "still-task",
        listenToFfmpegTaskProgress: () => () => {},
      },
      "../../systems/ProjectSystem": {
        getProjectExportContext: () => ({ projectId }),
        getProjectWorkspaceSnapshot: () => ({
          projects: projectId === "project-b" ? [] : [{ asset: { id: "original-asset" } }],
        }),
        applyImportedMediaResult: () => calls.push("applied"),
      },
      "../../systems/TaskSystem": { createTaskProgress: async () => task },
      "./mediaImportTask": {
        runMediaImportTask: async ({ path, onSuccess }: MediaImportCallOptions) => {
          calls.push({ importPath: path });
          if (switchDuringImport) projectId = "project-b";
          onSuccess({});
        },
      },
    },
  );
  const request = {
    assetId: "original-asset",
    mediaName: "renamed.mov",
    frame: 254,
    frameRate: 25,
    timecode: "00_00_10_04",
    projectId,
    proxyPath: "/proxy/low-resolution.mp4",
  };
  const settings: StillExportSettings = {
    name: "renamed.mov.00_00_10_04.Still001",
    automaticName: true,
    directory: "/output",
    format: "png",
    importIntoProject: true,
  };
  return { calls, run: () => module.runStillExportTask(request, settings) };
}

test("still export snapshots frame and media-bin name, exports original asset and imports output", async () => {
  const harness = taskHarness();
  await harness.run();
  const command = harness.calls[0] as { command: string; args: StillExportCommandArgs };
  assert.equal(command.command, "export_still_frame");
  assert.equal(command.args.assetId, "original-asset");
  assert.equal(command.args.options.mediaName, "renamed.mov");
  assert.equal(command.args.options.frame, 254);
  assert.equal(command.args.options.timecode, "00_00_10_04");
  assert.equal("proxyPath" in command.args.options, false);
  assert.ok(
    harness.calls.some(
      (call) => typeof call === "object" && call.importPath === "/output/still.png",
    ),
  );
  assert.ok(harness.calls.includes("applied"));
});

test("switching projects before or during import never adds a still to another project", async () => {
  for (const options of [
    { switchDuringExport: true },
    { switchDuringImport: true },
    { unsaved: true, switchDuringExport: true },
    { unsaved: true, switchDuringImport: true },
  ]) {
    const harness = taskHarness(options);
    await harness.run();
    assert.equal(harness.calls.includes("applied"), false);
  }
});

test("an unsaved media-import session can import its exported frame", async () => {
  const harness = taskHarness({ unsaved: true });
  await harness.run();
  assert.ok(harness.calls.includes("applied"));
});

test("failed original-frame export reports failure and never starts import", async () => {
  const harness = taskHarness({ failure: true });
  await harness.run();
  assert.ok(harness.calls.includes("failed"));
  assert.equal(
    harness.calls.some((call) => typeof call === "object" && Boolean(call.importPath)),
    false,
  );
});
