import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

type TypesModule = typeof import("../../../src/systems/TranscodeSystem/transcodeTypes.ts");
type CatalogModule = typeof import("../../../src/systems/TranscodeSystem/transcodeCatalog.ts");
type OutputModule = typeof import("../../../src/systems/TranscodeSystem/transcodeOutput.ts");
type PresetsModule = typeof import("../../../src/systems/TranscodeSystem/transcodePresets.ts");
type QueueModule = typeof import("../../../src/systems/TranscodeSystem/transcodeQueueState.ts");
type NavigationModule =
  typeof import("../../../src/systems/TranscodeSystem/transcodeQueueNavigation.ts");
type Capabilities =
  import("../../../src/systems/TranscodeSystem/transcodeTypes.ts").TranscodeCapabilities;

const load = createModuleLoader(import.meta.url);
const nodeRequire = createRequire(import.meta.url);
const globals = { structuredClone, crypto: globalThis.crypto };
const root = "../../../src/systems/TranscodeSystem/";

function loadSystem() {
  const types = load<TypesModule>(`${root}transcodeTypes.ts`, {}, globals);
  const catalog = load<CatalogModule>(`${root}transcodeCatalog.ts`, {}, globals);
  const output = load<OutputModule>(
    `${root}transcodeOutput.ts`,
    { "./transcodeCatalog": catalog },
    globals,
  );
  const presets = load<PresetsModule>(
    `${root}transcodePresets.ts`,
    { "./transcodeCatalog": catalog, "./transcodeTypes": types },
    globals,
  );
  const queue = load<QueueModule>(
    `${root}transcodeQueueState.ts`,
    (name) =>
      ({
        "./transcodePresets": presets,
        "./transcodeOutput": output,
        "./transcodeTypes": types,
      })[name] ?? nodeRequire(name),
    globals,
  );
  return { types, catalog, output, presets, queue };
}

function entry(name: string, codec?: string) {
  return { name, description: codec ? `${name} encoder (codec ${codec})` : name };
}

const capabilities: Capabilities = {
  version: "8.0",
  muxers: ["avi", "matroska", "mp4", "mov", "webm", "srt", "ass", "mp3", "nut", "wav"].map((name) =>
    entry(name),
  ),
  videoEncoders: [
    entry("mpeg4", "mpeg4"),
    entry("libx265", "hevc"),
    entry("libx264", "h264"),
    entry("h264_videotoolbox", "h264"),
    entry("prores_ks", "prores"),
    entry("libvpx-vp9", "vp9"),
    entry("zmbv", "zmbv"),
  ],
  audioEncoders: [
    entry("aac", "aac"),
    entry("libmp3lame", "mp3"),
    entry("libopus", "opus"),
    entry("pcm_s16le", "pcm_s16le"),
  ],
  subtitleEncoders: [
    entry("ass", "ass"),
    entry("srt", "subrip"),
    entry("subrip", "subrip"),
    entry("mov_text", "mov_text"),
    entry("webvtt", "webvtt"),
  ],
  filters: ["subtitles", "lut3d", "overlay", "loudnorm"],
};

test("containers list common formats first, MP4 then MKV, and the rest alphabetically", () => {
  const { catalog } = loadSystem();
  const values = catalog.optionValues(catalog.containerOptions(capabilities));
  assert.deepEqual([...values.slice(0, 4)], ["mp4", "matroska", "mov", "webm"]);
  assert.ok(values.indexOf("avi") < values.indexOf("mp3"));
  assert.ok(values.indexOf("srt") < values.indexOf("ass"));
  assert.equal(values.at(-1), "nut");
  assert.ok(catalog.containerOptions(capabilities).some((item) => "separator" in item));
});

test("encoders are filtered by container and ordered by how common they are", () => {
  const { catalog } = loadSystem();
  const mp4 = catalog.optionValues(catalog.videoEncoderOptions(capabilities, "mp4"));
  assert.deepEqual([...mp4.slice(0, 3)], ["libx264", "h264_videotoolbox", "libx265"]);
  assert.ok(!mp4.includes("prores_ks"));
  assert.equal(mp4.at(-1), "copy");
  const mkv = catalog.optionValues(catalog.videoEncoderOptions(capabilities, "matroska"));
  assert.ok(mkv.includes("zmbv") && mkv.includes("prores_ks"));
  const subtitles = catalog.optionValues(catalog.subtitleEncoderOptions(capabilities, "matroska"));
  assert.deepEqual([...subtitles], ["subrip", "ass", "webvtt"]);
  assert.deepEqual(
    [...catalog.optionValues(catalog.subtitleEncoderOptions(capabilities, "mp4"))],
    ["mov_text"],
  );
});

test("switching container repairs codecs and subtitle handling", () => {
  const { catalog, types } = loadSystem();
  const mkv = catalog.applyContainer(types.defaultTranscodeSettings(), "matroska", capabilities);
  assert.equal(mkv.extension, "mkv");
  assert.equal(mkv.subtitles.codec, "subrip");
  const webm = catalog.applyContainer(mkv, "webm", capabilities);
  assert.equal(webm.video.codec, "libvpx-vp9");
  assert.equal(webm.audio.codec, "libopus");
  const avi = catalog.applyContainer(types.defaultTranscodeSettings(), "avi", capabilities);
  assert.equal(avi.subtitles.mode, "sidecar");
  assert.equal(avi.exportSubtitles, false);
  const ass = catalog.applyContainer(types.defaultTranscodeSettings(), "ass", capabilities);
  assert.equal(ass.exportVideo, false);
  assert.equal(ass.exportAudio, false);
  assert.equal(ass.subtitles.codec, "ass");
  const mp3 = catalog.applyContainer(types.defaultTranscodeSettings(), "mp3", capabilities);
  assert.equal(mp3.exportVideo, false);
  assert.equal(mp3.audio.codec, "libmp3lame");
});

test("presets resolve hardware candidates and hide presets the installed FFmpeg lacks", () => {
  const { presets } = loadSystem();
  const hardware = presets.systemPresets.find((preset) => preset.id === "system:h264-hardware")!;
  assert.equal(
    presets.resolvePresetSettings(hardware, capabilities)?.video.codec,
    "h264_videotoolbox",
  );
  const av1 = presets.systemPresets.find((preset) => preset.id === "system:av1-high")!;
  assert.equal(presets.resolvePresetSettings(av1, capabilities), null);
  const available = presets
    .availablePresets(presets.systemPresets, capabilities)
    .map((preset) => preset.id);
  assert.ok(available.includes("system:h264-high"));
  assert.ok(available.includes("system:subtitle-ass"));
  assert.ok(!available.includes("system:audio-flac"));
});

test("preset files round-trip and reject foreign JSON", () => {
  const { presets, types } = loadSystem();
  const body = presets.serializePresetFile({
    name: "交付",
    settings: types.defaultTranscodeSettings(),
  });
  assert.equal(presets.parsePresetFile(body)?.name, "交付");
  assert.equal(presets.parsePresetFile('{"name":"x"}'), null);
  assert.equal(presets.parsePresetFile("not json"), null);
});

test("queued outputs require a destination and keep it for the next sources", () => {
  const { queue, output } = loadSystem();
  const store = queue.transcodeQueueStore;
  store.getState().setCapabilities(capabilities);
  const [first] = store.getState().addSources(["/media/a.mkv", "/media/a.mkv", "/media/b.mov"]);
  assert.equal(store.getState().sources.length, 2);
  assert.equal(first.outputs[0].outputName, "a");
  assert.equal(output.outputBlocker(first.outputs[0]), "请选择输出位置");

  const ids = store.getState().sources.flatMap((source) => source.outputs.map((item) => item.id));
  store.getState().setDestination(ids, { kind: "mediaBin", folderId: null });
  assert.ok(
    store.getState().sources.every((source) => output.outputBlocker(source.outputs[0]) === null),
  );
  const [next] = store.getState().addSources(["/media/c.mp4"]);
  assert.equal(next.outputs[0].destination?.kind, "mediaBin");
  assert.equal(
    output.resolveOutputDirectory(
      { kind: "mediaBin", folderId: null },
      "/media/c.mp4",
      "/projects/show",
    ),
    "/projects/show/encoder",
  );
  assert.equal(
    output.resolveOutputDirectory({ kind: "mediaBin", folderId: null }, "/media/c.mp4", ""),
    "/media/encoder",
  );
});

test("media bin destinations name any bin folder and restore older configs at the top level", () => {
  const { queue, output } = loadSystem();
  const folders = [
    { id: "b", name: "转码", parent_id: "a" },
    { id: "a", name: "素材", parent_id: null },
    { id: "c", name: "孤立", parent_id: "gone" },
  ];
  assert.equal(
    JSON.stringify(
      output.mediaBinFolderOutline(folders).map(({ folder, depth }) => [folder.id, depth]),
    ),
    '[["a",0],["b",1],["c",0]]',
  );
  assert.equal(
    output.destinationLabel({ kind: "mediaBin", folderId: "b" }, folders),
    "媒体箱 / 素材 / 转码",
  );
  assert.equal(output.destinationLabel({ kind: "mediaBin", folderId: null }, folders), "媒体箱");
  assert.equal(output.destinationLabel({ kind: "folder", directory: "/out" }, folders), "/out");
  assert.equal(output.destinationLabel(null, folders), "未设置");

  const store = queue.transcodeQueueStore;
  store
    .getState()
    .addSources(["/media/a.mkv"], { destination: { kind: "mediaBin", folderId: "b" } });
  const snapshot = JSON.parse(JSON.stringify(queue.transcodeConfigSnapshot(store.getState())));
  const fresh = loadSystem().queue.transcodeQueueStore;
  fresh.getState().restore(snapshot);
  assert.equal(
    JSON.stringify(fresh.getState().sources[0].outputs[0].destination),
    JSON.stringify({ kind: "mediaBin", folderId: "b" }),
  );

  // Before bin folders could be chosen, a media bin output carried no folder.
  delete snapshot.queue[0].outputs[0].destination.folderId;
  const legacy = loadSystem().queue.transcodeQueueStore;
  legacy.getState().restore(snapshot);
  assert.equal(
    JSON.stringify(legacy.getState().sources[0].outputs[0].destination),
    JSON.stringify({ kind: "mediaBin", folderId: null }),
  );
});

test("queue rows select like a file list from the keyboard and the pointer", () => {
  const navigation = load<NavigationModule>(`${root}transcodeQueueNavigation.ts`, {}, globals);
  const rows = ["s1", "o1", "o2", "s2", "o3"];
  const empty = { selectedIds: [], anchorId: null, focusId: null };

  const down = navigation.moveQueueCursor(rows, empty, "down");
  assert.equal(JSON.stringify(down), '{"selectedIds":["s1"],"anchorId":"s1","focusId":"s1"}');
  assert.equal(navigation.moveQueueCursor(rows, empty, "up").focusId, "o3");

  const extended = navigation.moveQueueCursor(
    rows,
    navigation.moveQueueCursor(rows, down, "down", { extend: true }),
    "down",
    { extend: true },
  );
  assert.equal(JSON.stringify(extended.selectedIds), '["s1","o1","o2"]');
  assert.equal(extended.anchorId, "s1");

  const moved = navigation.moveQueueCursor(rows, extended, "end", { toggle: true });
  assert.equal(moved.focusId, "o3");
  assert.equal(
    JSON.stringify(moved.selectedIds),
    '["s1","o1","o2"]',
    "Ctrl moves without selecting",
  );
  const toggled = navigation.toggleQueueFocus(moved);
  assert.equal(JSON.stringify(toggled.selectedIds), '["s1","o1","o2","o3"]');

  assert.equal(navigation.moveQueueCursor(rows, toggled, "pageUp").focusId, "s1");
  assert.equal(navigation.moveQueueCursor(rows, toggled, "down").focusId, "o3", "stays at the end");

  const clicked = navigation.clickQueueRow(rows, empty, "o1");
  const range = navigation.clickQueueRow(rows, clicked, "s2", { extend: true });
  assert.equal(JSON.stringify(range.selectedIds), '["o1","o2","s2"]');
  const removed = navigation.clickQueueRow(rows, range, "o2", { toggle: true });
  assert.equal(JSON.stringify(removed.selectedIds), '["o1","s2"]');
});

test("queue selection edits, duplicates and persists without runtime status", () => {
  const { queue } = loadSystem();
  const store = queue.transcodeQueueStore;
  const [source] = store
    .getState()
    .addSources(["/media/a.mkv"], { destination: { kind: "folder", directory: "/out" } });
  const outputId = source.outputs[0].id;
  store.getState().updateOutput(outputId, { status: "encoding", progress: 0.5 });
  store.getState().select([outputId]);
  store.getState().removeSelected();
  assert.equal(store.getState().sources[0].outputs.length, 1, "a running output is never removed");

  store.getState().updateOutput(outputId, { status: "failed" });
  store.getState().select([outputId]);
  store.getState().duplicateSelected();
  assert.equal(store.getState().sources[0].outputs.length, 2);
  assert.equal(store.getState().sources[0].outputs[1].status, "ready");

  const snapshot = queue.transcodeConfigSnapshot(store.getState());
  const fresh = loadSystem().queue.transcodeQueueStore;
  fresh.getState().restore(JSON.parse(JSON.stringify(snapshot)));
  const restored = fresh.getState().sources[0];
  assert.equal(restored.path, "/media/a.mkv");
  assert.equal(JSON.stringify(restored.outputs.map((item) => item.status)), '["failed","ready"]');
  assert.equal(
    JSON.stringify(restored.outputs[0].destination),
    JSON.stringify({ kind: "folder", directory: "/out" }),
  );
});

test("timecodes parse and format symmetrically", () => {
  const { output } = loadSystem();
  assert.equal(output.parseTimecode("01:02:03.5"), 3_723_500_000);
  assert.equal(output.parseTimecode("90"), 90_000_000);
  assert.equal(output.parseTimecode("1:xx"), null);
  assert.equal(output.formatTimecode(3_723_500_000), "01:02:03.500");
  assert.equal(output.formatTimecode(null), "");
});

function sourceInfo(
  streams: { audio?: boolean; subtitles?: string[] } = {},
): import("../../../src/systems/TranscodeSystem/transcodeTypes.ts").TranscodeSourceInfo {
  const stream = (index: number, codec: string) => ({
    index,
    codec,
    language: null,
    title: null,
    width: 1920,
    height: 1080,
    frameRate: "25/1",
    sampleRate: 48_000,
    channels: 2,
    bitmap: false,
    colorTransfer: null,
  });
  return {
    durationUs: 6_000_000,
    video: [stream(0, "h264")],
    audio: streams.audio === false ? [] : [stream(0, "aac")],
    subtitles: (streams.subtitles ?? []).map((codec, index) => stream(index, codec)),
  };
}

test("moving to MKV keeps the source subtitle format when the container holds it", () => {
  const { catalog, types } = loadSystem();
  const withAss = sourceInfo({ subtitles: ["ass"] });
  const mkv = catalog.applyContainer(
    types.defaultTranscodeSettings(),
    "matroska",
    capabilities,
    undefined,
    withAss,
  );
  assert.equal(mkv.subtitles.codec, "ass");
  const withPgs = sourceInfo({ subtitles: ["hdmv_pgs_subtitle"] });
  const fallback = catalog.applyContainer(
    types.defaultTranscodeSettings(),
    "matroska",
    capabilities,
    undefined,
    withPgs,
  );
  assert.equal(fallback.subtitles.codec, "subrip");
});

test("the output summary leaves out streams the source does not have", () => {
  const { output, types } = loadSystem();
  const settings = types.defaultTranscodeSettings();
  const silent = output.outputSummary(settings, sourceInfo({ audio: false }));
  assert.equal(silent.length, 1, "only the video line remains");
  assert.match(silent[0], /H\.264/);
  const full = output.outputSummary(settings, sourceInfo({ subtitles: ["subrip"] }));
  assert.equal(full.length, 3);
  assert.equal(output.outputSummary(settings, null).length, 3, "unknown sources show everything");
});

test("presets in the queue are named with their group", () => {
  const { queue, presets } = loadSystem();
  const hevc = presets.systemPresets.find(
    (preset) => preset.group !== presets.systemPresets[0].group,
  )!;
  assert.equal(
    queue.transcodePresetLabel({ userPresets: [] }, hevc.id, hevc.name),
    `${hevc.group} · ${hevc.name}`,
  );
  assert.equal(queue.transcodePresetLabel({ userPresets: [] }, null, "自定义"), "自定义");
});

test("the panel layout is saved and restored with the transcode config", () => {
  const { queue } = loadSystem();
  const store = queue.transcodeQueueStore;
  const layout = { instances: [{ id: "transcode-queue", type: "transcode-queue", params: {} }] };
  store.getState().setPanelLayout(layout);
  const snapshot = JSON.parse(JSON.stringify(queue.transcodeConfigSnapshot(store.getState())));
  assert.deepEqual(snapshot.panelLayout, layout);
  store.getState().setPanelLayout(null);
  store.getState().restore(snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().panelLayout)), layout);
});

type SendModule = typeof import("../../../src/application/sendExportToTranscode.ts");
type ExportClip = import("../../../src/systems/ExportSystem/exportTypes.ts").ExportClip;

function loadSendToTranscode() {
  const system = loadSystem();
  const exportTypes = load<typeof import("../../../src/systems/ExportSystem/exportTypes.ts")>(
    "../../../src/systems/ExportSystem/exportTypes.ts",
    {},
  );
  const rename = load<typeof import("../../../src/systems/ExportSystem/exportRename.ts")>(
    "../../../src/systems/ExportSystem/exportRename.ts",
    {
      "../../core/editor/time": { formatMonitorTime: () => "00:00:00:00" },
      "./exportTypes": exportTypes,
    },
  );
  const exportSystem = {
    ...exportTypes,
    computeExportFileNames: rename.computeExportFileNames,
    normalizeExportSettings: (settings: unknown) => settings,
    composeExportOutputDir: () => "",
    resolveExportDestinationDir: async () => "",
  };
  const transcodeSystem = {
    ...system.types,
    ...system.catalog,
    transcodeQueueStore: system.queue.transcodeQueueStore,
    enqueueTranscodeJobs: system.queue.transcodeQueueStore.getState().addJobs,
  };
  const send = load<SendModule>(
    "../../../src/application/sendExportToTranscode.ts",
    { "../systems/ExportSystem": exportSystem, "../systems/TranscodeSystem": transcodeSystem },
    globals,
  );
  return { send, queue: system.queue };
}

function exportSettings(
  patch: Partial<import("../../../src/systems/ExportSystem/exportTypes.ts").ExportSettings> = {},
) {
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
    outputDir: "/out",
    outputStem: "clip",
    renameRule: "label",
    customName: "",
    startNumber: 1,
    extensionCase: "lower",
    outputName: "",
    existingFileMode: "ask",
    ...patch,
  } as const;
}

function clip(id: string, sourcePath: string, startUs: number, endUs: number): ExportClip {
  return {
    id,
    videoId: `video-${sourcePath}`,
    sourcePath,
    label: `片段${id}`,
    sourceName: sourcePath,
    startUs,
    endUs,
    hasVideo: true,
    hasAudio: true,
    audioSources: [{ sourcePath, audioTrackIndex: 0, primary: true }],
    durationUs: 60_000_000,
    videoStreamIndex: 0,
    proxyPath: null,
  };
}

test("export settings carry over to transcode settings", () => {
  const { send } = loadSendToTranscode();
  const h264 = send.transcodeSettingsFromExport(
    exportSettings({ quality: "very_high", encoderSpeed: "quality", frameRate: 25 }),
    capabilities,
  );
  assert.equal(h264.container, "mp4");
  assert.equal(h264.video.codec, "libx264");
  assert.equal(h264.video.rateControl, "quality");
  assert.equal(h264.video.quality, 17);
  assert.equal(h264.video.speedPreset, "slow");
  assert.equal(h264.video.frameRate, "25");
  assert.equal(h264.audio.bitrateKbps, 192);
  assert.equal(h264.audio.channels, 2);
  assert.equal(h264.exportSubtitles, false);

  const vp9 = send.transcodeSettingsFromExport(
    exportSettings({ container: "webm_vp9", quality: "low", resolution: "custom" }),
    capabilities,
  );
  assert.equal(vp9.video.codec, "libvpx-vp9");
  assert.equal(vp9.video.quality, 40);
  assert.equal(vp9.video.width, 1920);
  assert.equal(vp9.video.height, 1080);

  const prores = send.transcodeSettingsFromExport(
    exportSettings({ container: "mov_prores", quality: "medium" }),
    capabilities,
  );
  assert.equal(prores.video.codec, "prores_ks");
  assert.equal(prores.video.profile, "2");

  const mp3 = send.transcodeSettingsFromExport(
    exportSettings({ container: "mp3_audio", audioCodec: "mp3" }),
    capabilities,
  );
  assert.equal(mp3.exportVideo, false);
  assert.equal(mp3.audio.codec, "libmp3lame");
});

test("clips go to the queue as one source per file with an output and range per clip", () => {
  const { send, queue } = loadSendToTranscode();
  const clips = [
    clip("1", "/media/a.mkv", 1_000_000, 4_000_000),
    clip("2", "/media/a.mkv", 10_000_000, 0),
    clip("3", "/media/b.mp4", 0, 2_000_000),
  ];
  clips[2].audioSources.push({
    sourcePath: "/media/music.wav",
    audioTrackIndex: 0,
    primary: false,
  });
  const plan = send.planExportToTranscode(clips, exportSettings(), "/out", capabilities);
  assert.equal(plan.jobs.length, 2);
  assert.equal(plan.audioChangedCount, 1);
  const [a, b] = plan.jobs;
  assert.equal(a.path, "/media/a.mkv");
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        a.outputs.map((output) => [
          output.outputName,
          output.settings.rangeStartUs,
          output.settings.rangeEndUs,
        ]),
      ),
    ),
    [
      ["片段1", 1_000_000, 4_000_000],
      ["片段2", 10_000_000, null],
    ],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(b.outputs[0].destination)), {
    kind: "folder",
    directory: "/out",
  });
  assert.equal(b.outputs[0].settings.rangeStartUs, null);

  // A file already in the queue is queued again with the clips' own outputs.
  const store = queue.transcodeQueueStore;
  store.getState().addSources(["/media/a.mkv"]);
  const added = store.getState().addJobs(plan.jobs);
  assert.equal(added.length, 2);
  assert.equal(store.getState().sources.length, 3);
  assert.equal(added[0].outputs[1].outputName, "片段2");
  assert.equal(store.getState().selectedIds.length, 3);
});

test("merging several clips cannot be sent to the transcode queue", () => {
  const { send } = loadSendToTranscode();
  assert.equal(send.exportToTranscodeBlocker(0, exportSettings()), "请先勾选要发送的片段");
  assert.match(send.exportToTranscodeBlocker(2, exportSettings({ mode: "merge" }))!, /无法合并/);
  assert.equal(send.exportToTranscodeBlocker(1, exportSettings({ mode: "merge" })), null);
  assert.equal(send.exportToTranscodeBlocker(2, exportSettings()), null);
});
