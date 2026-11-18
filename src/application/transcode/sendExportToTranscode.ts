import {
  composeExportOutputDir,
  computeExportFileNames,
  exportContainerOptions,
  normalizeExportSettings,
  resolveExportDestinationDir,
  type ExportClip,
  type ExportContainer,
  type ExportQuality,
  type ExportSettings,
  type ExportSource,
} from "../../systems/ExportSystem";
import { resolveExportClipRange } from "../../core/editor/export/exportRange";
import {
  applyContainer,
  defaultTranscodeSettings,
  enqueueTranscodeJobs,
  retargetVideoCodec,
  transcodeQueueStore,
  type TranscodeCapabilities,
  type TranscodeJob,
  type TranscodeSettings,
} from "../../systems/TranscodeSystem";

/** FFmpeg muxer and video encoder for each export format; audio-only formats have no encoder. */
const containerEncoders: Record<ExportContainer, { muxer: string; video: string | null }> = {
  mp4_h264: { muxer: "mp4", video: "libx264" },
  mp4_hevc: { muxer: "mp4", video: "libx265" },
  mov_prores: { muxer: "mov", video: "prores_ks" },
  webm_vp9: { muxer: "webm", video: "libvpx-vp9" },
  mp3_audio: { muxer: "mp3", video: null },
  aac_audio: { muxer: "adts", video: null },
};

/** The export page's CRF for each quality, as `export_crf` in the backend uses it. */
function exportCrf(container: ExportContainer, quality: ExportQuality) {
  const table: Record<ExportQuality, number> =
    container === "webm_vp9"
      ? { low: 40, medium: 34, high: 28, very_high: 24 }
      : { low: 28, medium: 23, high: 20, very_high: 17 };
  return table[quality];
}

const proresProfile: Record<ExportQuality, string> = {
  low: "0",
  medium: "2",
  high: "3",
  very_high: "3",
};

const x26xSpeed = { fast: "veryfast", balanced: "medium", quality: "slow" } as const;
const vp9Speed = { fast: "8", balanced: "4", quality: "2" } as const;

const audioEncoders = { aac: "aac", mp2: "mp2", mp3: "libmp3lame", opus: "libopus" } as const;
const audioChannelCounts = { mono: 1, stereo: 2, "5.1": 6 } as const;

/**
 * The transcode settings that encode like the export page would: same
 * format, quality, speed, size, frame rate and audio. The source range is
 * left open; each clip sets its own.
 */
export function transcodeSettingsFromExport(
  exportSettings: ExportSettings,
  capabilities: TranscodeCapabilities | null,
): TranscodeSettings {
  const settings = normalizeExportSettings(exportSettings);
  const { muxer, video } = containerEncoders[settings.container];
  const result = applyContainer(defaultTranscodeSettings(), muxer, capabilities);
  result.exportSubtitles = false;
  result.exportVideo = video !== null && settings.includeVideo;
  result.exportAudio = settings.includeAudio;
  if (video) {
    result.video = retargetVideoCodec(result.video, video);
    if (video === "prores_ks") {
      result.video.profile = proresProfile[settings.quality];
    } else {
      result.video.rateControl = "quality";
      result.video.quality = exportCrf(settings.container, settings.quality);
      result.video.speedPreset = (video === "libvpx-vp9" ? vp9Speed : x26xSpeed)[
        settings.encoderSpeed
      ];
    }
    if (settings.resolution === "custom") {
      result.video.width = settings.customWidth;
      result.video.height = settings.customHeight;
    }
    result.video.frameRate = settings.frameRate === null ? null : String(settings.frameRate);
  }
  result.audio.codec = audioEncoders[settings.audioCodec];
  result.audio.sampleRate = settings.audioSampleRateHz;
  result.audio.channels = audioChannelCounts[settings.audioChannels];
  result.audio.bitrateKbps = settings.audioBitrateKbps;
  // The export page mixes in the clip's one bound track, not every track.
  result.audio.tracks = "first";
  return result;
}

/** The file a clip reads, following 使用代理 the way the export task does. */
function clipInputPath(clip: ExportClip, useProxy: boolean) {
  const proxyCanSupplyAudio = !clip.audioSources.some(
    (source) => source.primary && source.audioTrackIndex !== 0,
  );
  return (useProxy && proxyCanSupplyAudio && clip.proxyPath) || clip.sourcePath;
}

/** True when the transcode queue cannot reproduce the audio the export page would mix. */
function hasUnsupportedAudio(clip: ExportClip) {
  return clip.audioSources.some((source) => !source.primary || source.audioTrackIndex !== 0);
}

export interface ExportToTranscodePlan {
  jobs: TranscodeJob[];
  clipCount: number;
  /** Clips whose bound audio (another file or track) the queue keeps as the file's first track. */
  audioChangedCount: number;
}

/** Turns the selected clips into queue jobs: one source per file, one output per clip. */
export function planExportToTranscode(
  clips: readonly ExportClip[],
  exportSettings: ExportSettings,
  outputDirectory: string,
  capabilities: TranscodeCapabilities | null,
): ExportToTranscodePlan {
  const settings = normalizeExportSettings(exportSettings);
  const base = transcodeSettingsFromExport(settings, capabilities);
  const label =
    exportContainerOptions.find(([value]) => value === settings.container)?.[1] ?? "自定义";
  const names = new Map(
    computeExportFileNames(clips, settings).map((entry) => [
      entry.clipId,
      entry.fileName.replace(/\.[^.]+$/u, ""),
    ]),
  );
  const destination = outputDirectory
    ? ({ kind: "folder", directory: outputDirectory } as const)
    : null;
  const jobs = new Map<string, TranscodeJob>();
  for (const clip of clips) {
    const range = resolveExportClipRange(clip, settings.rangeExtension);
    const path = clipInputPath(clip, settings.useProxy);
    const job = jobs.get(path) ?? { path, outputs: [] };
    jobs.set(path, job);
    job.outputs.push({
      settings: {
        ...structuredClone(base),
        rangeStartUs: range.startUs > 0 ? range.startUs : null,
        rangeEndUs: range.endUs > 0 ? range.endUs : null,
      },
      presetName: `导出设置 · ${label}`,
      outputName: names.get(clip.id) ?? clip.label,
      destination,
    });
  }
  return {
    jobs: [...jobs.values()],
    clipCount: clips.length,
    audioChangedCount: clips.filter(hasUnsupportedAudio).length,
  };
}

/** Why the selection cannot go to the transcode queue, or null when it can. */
export function exportToTranscodeBlocker(clipCount: number, settings: ExportSettings) {
  if (clipCount === 0) return "请先勾选要发送的片段";
  if (settings.mode === "merge" && clipCount > 1) {
    return "转码队列逐个处理文件，无法合并片段；请改为逐个导出";
  }
  return null;
}

/** Sends the export page's clips and settings to the transcode queue. */
export async function sendExportToTranscode(source: ExportSource, settings: ExportSettings) {
  const normalized = normalizeExportSettings(settings);
  const outputDirectory = composeExportOutputDir(
    normalized.destination === "specified"
      ? normalized
      : {
          ...normalized,
          outputDir: await resolveExportDestinationDir(normalized.destination, source),
        },
  );
  const plan = planExportToTranscode(
    source.clips,
    normalized,
    outputDirectory,
    transcodeQueueStore.getState().capabilities,
  );
  enqueueTranscodeJobs(plan.jobs);
  return plan;
}
