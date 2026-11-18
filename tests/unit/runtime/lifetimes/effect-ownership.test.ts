import assert from "node:assert/strict";
import test from "node:test";
import { focusedSearchHitId } from "../../../../src/core/editor/search/searchFocus.ts";
import { withoutEmptySelectionFilter } from "../../../../src/core/editor/selection/selectionFilter.ts";
import type {
  ExportSettings,
  ExportSource,
} from "../../../../src/core/editor/export/exportTypes.ts";
import { createModuleLoader } from "../../support/module-loader.ts";

const loadModule = createModuleLoader(import.meta.url);
const exportTypes = loadModule<typeof import("../../../../src/core/editor/export/exportTypes.ts")>(
  "../../../../src/core/editor/export/exportTypes.ts",
);
const exportRename = loadModule<
  typeof import("../../../../src/systems/ExportSystem/exportRename.ts")
>("../../../../src/systems/ExportSystem/exportRename.ts", {
  "../../core/editor/playback/time": { formatMonitorTime: () => "00:00:00:00" },
  "../../core/editor/export/exportTypes": exportTypes,
});
const { constrainExportSettings } = loadModule<
  typeof import("../../../../src/systems/ExportSystem/exportSettingsConstraints.ts")
>("../../../../src/systems/ExportSystem/exportSettingsConstraints.ts", {
  "../../core/editor/export/exportTypes": exportTypes,
  "./exportRename": exportRename,
});

test("highlight focus follows a hit and keeps the previous hit when the active row is not one", () => {
  assert.equal(
    focusedSearchHitId({
      highlight: false,
      query: "cut",
      activeId: "a",
      activeIsHit: true,
      previousHitId: "b",
    }),
    null,
  );
  assert.equal(
    focusedSearchHitId({
      highlight: true,
      query: "   ",
      activeId: "a",
      activeIsHit: true,
      previousHitId: "b",
    }),
    null,
  );
  assert.equal(
    focusedSearchHitId({
      highlight: true,
      query: "cut",
      activeId: "a",
      activeIsHit: true,
      previousHitId: "b",
    }),
    "a",
  );
  assert.equal(
    focusedSearchHitId({
      highlight: true,
      query: "cut",
      activeId: "c",
      activeIsHit: false,
      previousHitId: "b",
    }),
    "b",
  );
});

test("show-only-selected turns off when the selection becomes empty and stays when it does not", () => {
  const selected = { showOnlySelected: true, label: "keep" };
  assert.equal(withoutEmptySelectionFilter(2, selected), selected);
  assert.equal(
    withoutEmptySelectionFilter(0, { showOnlySelected: false, label: "keep" }).label,
    "keep",
  );
  assert.deepEqual(withoutEmptySelectionFilter(0, selected), {
    showOnlySelected: false,
    label: "keep",
  });
});

function exportSettings(patch: Partial<ExportSettings> = {}): ExportSettings {
  return {
    mode: "individual",
    container: "mp4_h264",
    resolution: "match_source",
    customWidth: 1920,
    customHeight: 1080,
    frameRate: null,
    quality: "high",
    encoderSpeed: "balanced",
    hardwareAcceleration: "auto",
    includeVideo: true,
    includeAudio: true,
    audioCodec: "aac",
    audioSampleRateHz: null,
    audioChannels: "stereo",
    audioBitrateKbps: 192,
    importIntoProject: false,
    useProxy: false,
    destination: "specified",
    useSubfolder: false,
    subfolderName: "",
    outputDir: "",
    outputStem: "",
    renameRule: "filename",
    customName: "",
    startNumber: 1,
    extensionCase: "lower",
    outputName: "",
    existingFileMode: "ask",
    ...patch,
  };
}

function source(hasAudio: boolean, channels: number | null): ExportSource {
  return {
    kind: "storyboard",
    title: "shots",
    clips: [
      {
        id: "clip",
        videoId: "video",
        sourcePath: "/media/clip.mp4",
        label: "clip",
        sourceName: "clip",
        startUs: 0,
        endUs: 1,
        hasVideo: true,
        hasAudio,
        audioSources: [],
        durationUs: 1,
        videoStreamIndex: 0,
        proxyPath: null,
        sourceMedia:
          channels === null
            ? undefined
            : {
                fileName: "clip.mp4",
                container: "MP4",
                videoCodec: "h264",
                audioCodec: "aac",
                audioChannels: channels,
                width: 1,
                height: 1,
                frameRate: 24,
                pixelAspectRatio: 1,
                audioSampleRateHz: 48000,
                audioChannelLayout: "stereo",
                fileSize: 1,
                durationUs: 1,
              },
      },
    ],
  };
}

test("export settings snap to the source constraints and stay put when already valid", () => {
  const valid = exportSettings();
  assert.equal(
    constrainExportSettings(valid, {
      source: null,
      selectedClipIds: new Set(),
      previewClipId: null,
    }),
    valid,
  );

  const merged = constrainExportSettings(exportSettings({ mode: "merge", renameRule: "label" }), {
    source: source(true, 2),
    selectedClipIds: new Set(["clip"]),
    previewClipId: "clip",
  });
  assert.equal(merged.renameRule, "filename");
  assert.equal(
    constrainExportSettings(merged, {
      source: source(true, 2),
      selectedClipIds: new Set(["clip"]),
      previewClipId: "clip",
    }),
    merged,
  );

  const silent = constrainExportSettings(
    exportSettings({ container: "mp3_audio", includeVideo: false, audioCodec: "mp3" }),
    { source: source(false, null), selectedClipIds: new Set(["clip"]), previewClipId: "clip" },
  );
  assert.equal(silent.container, "mp4_h264");
  assert.equal(silent.audioCodec, "aac");
  assert.equal(silent.includeAudio, false);
  assert.equal(silent.includeVideo, true);

  const absentSource = constrainExportSettings(
    exportSettings({ container: "mp3_audio", audioCodec: "mp3" }),
    { source: null, selectedClipIds: new Set(), previewClipId: null },
  );
  assert.equal(absentSource.container, "mp3_audio");

  const surround = constrainExportSettings(
    exportSettings({ audioCodec: "mp3", audioChannels: "5.1" }),
    { source: source(true, 6), selectedClipIds: new Set(["clip"]), previewClipId: "clip" },
  );
  assert.equal(surround.audioChannels, "stereo");

  const bitrate = constrainExportSettings(exportSettings({ audioBitrateKbps: 1 }), {
    source: source(true, 2),
    selectedClipIds: new Set(["clip"]),
    previewClipId: "clip",
  });
  assert.equal(bitrate.audioBitrateKbps, 16);

  const sampleRate = constrainExportSettings(exportSettings({ audioSampleRateHz: 1 }), {
    source: source(true, 2),
    selectedClipIds: new Set(["clip"]),
    previewClipId: "clip",
  });
  assert.equal(sampleRate.audioSampleRateHz, 16000);
});

test("project state subscribers hear load completion and not a later load after unsubscribe", async () => {
  const cache = loadModule<
    typeof import("../../../../src/systems/ProjectSystem/ProjectStatesCache.ts")
  >("../../../../src/systems/ProjectSystem/ProjectStatesCache.ts", {
    "../../runtime/errors": {
      invokeCommand: async () => ({ "project-1": { exportState: null, panelStates: {} } }),
    },
  });
  let notifications = 0;
  const unsubscribe = cache.subscribeProjectStatesLoaded(() => {
    notifications += 1;
  });
  assert.equal(cache.projectStatesLoaded(), false);
  await cache.loadProjectStates();
  assert.equal(cache.projectStatesLoaded(), true);
  assert.equal(notifications, 1);
  unsubscribe();
  await cache.loadProjectStates();
  assert.equal(notifications, 1);
});
