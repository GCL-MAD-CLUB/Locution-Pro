import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

type TypesModule = typeof import("../../../src/systems/TranscodeSystem/transcodeTypes.ts");
type CatalogModule = typeof import("../../../src/systems/TranscodeSystem/transcodeCatalog.ts");
type OutputModule = typeof import("../../../src/systems/TranscodeSystem/transcodeOutput.ts");
type PresetsModule = typeof import("../../../src/systems/TranscodeSystem/transcodePresets.ts");
type QueueModule = typeof import("../../../src/systems/TranscodeSystem/transcodeQueueState.ts");
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
  store.getState().setDestination(ids, { kind: "mediaBin" });
  assert.ok(
    store.getState().sources.every((source) => output.outputBlocker(source.outputs[0]) === null),
  );
  const [next] = store.getState().addSources(["/media/c.mp4"]);
  assert.equal(next.outputs[0].destination?.kind, "mediaBin");
  assert.equal(
    output.resolveOutputDirectory({ kind: "mediaBin" }, "/media/c.mp4", "/projects/show"),
    "/projects/show/encoder",
  );
  assert.equal(
    output.resolveOutputDirectory({ kind: "mediaBin" }, "/media/c.mp4", ""),
    "/media/encoder",
  );
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
