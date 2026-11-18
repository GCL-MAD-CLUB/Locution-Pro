import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import type { ExportSource } from "../../../src/core/editor/export/exportTypes.ts";
import type { MediaBinItem, MediaDocument, MediaStream } from "../../../src/types.ts";

const nodeRequire = createRequire(import.meta.url);
const modules = new Map<string, Record<string, unknown>>();

function resolveRelative(dir: string, spec: string) {
  if (spec.includes(".css") || spec.includes("?")) return `stub:${spec}`;
  const path = resolve(dir, spec);
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}/index.ts`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve ${spec} from ${dir}`);
}

function loadModule(filename: string): Record<string, unknown> {
  if (filename.startsWith("stub:")) return {};
  const cached = modules.get(filename);
  if (cached) return cached;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText;
  const exports: Record<string, unknown> = {};
  modules.set(filename, exports);
  const dir = dirname(filename);
  runInNewContext(
    compiled,
    {
      exports,
      require: (spec: string) =>
        spec.startsWith(".") ? loadModule(resolveRelative(dir, spec)) : nodeRequire(spec),
      window: { localStorage: { getItem: () => null, setItem: () => {} } },
      document: { documentElement: { style: { setProperty() {} } } },
    },
    { filename },
  );
  return exports;
}

const workspace = loadModule(
  fileURLToPath(
    new URL("../../../src/systems/ExportSystem/exportWorkspaceState.ts", import.meta.url),
  ),
) as typeof import("../../../src/systems/ExportSystem/exportWorkspaceState.ts");
const resolvers = loadModule(
  fileURLToPath(new URL("../../../src/systems/ExportSystem/exportResolvers.ts", import.meta.url)),
) as typeof import("../../../src/systems/ExportSystem/exportResolvers.ts");

function stream(index: number, codecType: string, channels: number | null = null): MediaStream {
  return {
    index,
    codec_type: codecType,
    codec_name: codecType === "video" ? "h264" : "aac",
    language: null,
    title: null,
    width: codecType === "video" ? 1920 : null,
    height: codecType === "video" ? 1080 : null,
    channels,
    disposition: {},
  };
}

function videoItem(id: string): MediaBinItem {
  return {
    id,
    bin_id: null,
    kind: "video",
    enabled: true,
    hidden: false,
    offline: false,
    path: "/media/clip.mp4",
    file_name: "clip.mp4",
    duration_us: 1_000_000,
    start_time_us: 0,
    bound_to_video_id: null,
    source_video_id: null,
    stream_index: 0,
    subtitle_track_id: null,
    codec: "h264",
    language: null,
    extracted: false,
    origin: "imported",
    color: "#fff",
  };
}

function audioItem(id: string, videoId: string): MediaBinItem {
  return {
    ...videoItem(id),
    kind: "audio",
    path: "/media/surround.wav",
    file_name: "surround.wav",
    bound_to_video_id: videoId,
    stream_index: 0,
    codec: "pcm",
  };
}

function project(id: string, audioChannels: number | null): MediaDocument {
  const streams = [stream(0, "video")];
  if (audioChannels !== null) streams.push(stream(1, "audio", audioChannels));
  return {
    asset: {
      id,
      path: "/media/clip.mp4",
      file_name: "clip.mp4",
      file_size: 1,
      modified_at: 0,
      fingerprint: "fingerprint",
      duration_us: 1_000_000,
      start_time_us: 0,
      tape_name: null,
      video_stream_index: 0,
      audio_stream_index: audioChannels === null ? null : 1,
    },
    streams,
    tracks: [],
    cues: {},
    cache_dir: "/cache",
    proxy_path: null,
  };
}

function surroundFile(id: string): MediaDocument {
  const base = project(id, 6);
  return {
    ...base,
    asset: {
      ...base.asset,
      path: "/media/surround.wav",
      file_name: "surround.wav",
      video_stream_index: null,
      audio_stream_index: 0,
    },
    streams: [stream(0, "audio", 6)],
  };
}

const savedSource: ExportSource = {
  kind: "media-bin",
  title: "1 个视频",
  assetId: "video",
  clips: [
    {
      id: "media:video",
      videoId: "video",
      sourcePath: "/media/clip.mp4",
      label: "clip.mp4",
      sourceName: "clip.mp4",
      startUs: 12,
      endUs: 34,
      hasVideo: true,
      hasAudio: false,
      audioSources: [],
      durationUs: 1_000_000,
      videoStreamIndex: 0,
      proxyPath: null,
    },
  ],
};

function returnToExport(
  mediaItems: MediaBinItem[],
  projects: Record<string, MediaDocument>,
  detachedVideoIds = new Set<string>(),
) {
  const saved = workspace.exportWorkspaceStore.getState().source ?? savedSource;
  const shown = resolvers.refreshExportSourceAudioBindings(
    saved,
    mediaItems,
    projects,
    detachedVideoIds,
  );
  workspace.exportWorkspaceStore.getState().adoptExportSource(shown);
  return shown;
}

test("returning to export without reselecting uses the audio binding changed in the edit workspace", () => {
  const videoId = "video";
  workspace.exportWorkspaceStore.getState().setSource(savedSource);
  assert.equal(workspace.exportWorkspaceStore.getState().settings.includeAudio, false);
  assert.equal(workspace.exportWorkspaceStore.getState().source?.clips[0]?.startUs, 12);

  const audioId = "audio";
  const bound = returnToExport([videoItem(videoId), audioItem(audioId, videoId)], {
    [videoId]: project(videoId, null),
    [audioId]: surroundFile(audioId),
  });
  assert.equal(bound.clips[0]?.hasAudio, true);
  assert.equal(bound.clips[0]?.sourceMedia?.audioChannels, 6);
  assert.equal(bound.clips[0]?.startUs, 12);
  workspace.exportWorkspaceStore.getState().updateSettings({ includeAudio: true }, bound);
  assert.equal(workspace.exportWorkspaceStore.getState().settings.includeAudio, true);
  workspace.exportWorkspaceStore.getState().updateSettings({ audioChannels: "5.1" }, bound);
  assert.equal(workspace.exportWorkspaceStore.getState().settings.audioChannels, "5.1");

  const stereo = returnToExport([videoItem(videoId)], { [videoId]: project(videoId, 2) });
  workspace.exportWorkspaceStore.getState().updateSettings({ audioChannels: "5.1" }, stereo);
  assert.equal(workspace.exportWorkspaceStore.getState().settings.audioChannels, "stereo");

  const surround = returnToExport([videoItem(videoId)], { [videoId]: project(videoId, 6) });
  workspace.exportWorkspaceStore.getState().updateSettings({ audioChannels: "5.1" }, surround);
  assert.equal(workspace.exportWorkspaceStore.getState().settings.audioChannels, "5.1");
  assert.equal(workspace.exportWorkspaceStore.getState().settings.includeAudio, true);

  returnToExport([videoItem(videoId)], { [videoId]: project(videoId, null) });
  assert.equal(workspace.exportWorkspaceStore.getState().settings.includeAudio, false);
  assert.equal(workspace.exportWorkspaceStore.getState().settings.audioChannels, "stereo");
  assert.equal(workspace.exportWorkspaceStore.getState().source?.clips[0]?.hasAudio, false);
  workspace.exportWorkspaceStore.getState().setSource(null);
});
