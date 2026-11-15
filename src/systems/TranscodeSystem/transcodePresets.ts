import { applyContainer, retargetVideoCodec } from "./transcodeCatalog";
import {
  cloneTranscodeSettings,
  defaultTranscodeSettings,
  type TranscodeCapabilities,
  type TranscodePreset,
  type TranscodeSettings,
} from "./transcodeTypes";

type SettingsPatch = (settings: TranscodeSettings) => void;

function build(container: string, ...patches: SettingsPatch[]): TranscodeSettings {
  const settings = applyContainer(defaultTranscodeSettings(), container, null);
  for (const patch of patches) patch(settings);
  return settings;
}

function videoCodec(codec: string): SettingsPatch {
  return (settings) => {
    settings.video = retargetVideoCodec(settings.video, codec);
  };
}

function quality(value: number): SettingsPatch {
  return (settings) => {
    settings.video.rateControl = "quality";
    settings.video.quality = value;
  };
}

function height(value: number): SettingsPatch {
  return (settings) => {
    settings.video.height = value;
  };
}

function audio(codec: string, bitrateKbps: number | null): SettingsPatch {
  return (settings) => {
    settings.audio.codec = codec;
    settings.audio.bitrateKbps = bitrateKbps;
  };
}

function profile(value: string, pixelFormat?: string): SettingsPatch {
  return (settings) => {
    settings.video.profile = value;
    if (pixelFormat) settings.video.pixelFormat = pixelFormat;
  };
}

function preset(
  group: string,
  id: string,
  name: string,
  settings: TranscodeSettings,
  videoCodecCandidates?: string[],
): TranscodePreset {
  return { id: `system:${id}`, name, group, system: true, settings, videoCodecCandidates };
}

const hardwareH264 = ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf"];
const hardwareHevc = ["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_amf"];

const remux: SettingsPatch = (settings) => {
  settings.video = retargetVideoCodec(settings.video, "copy");
  settings.audio.codec = "copy";
};

const audioOnly: SettingsPatch = (settings) => {
  settings.exportSubtitles = false;
};

/** Built-in presets, grouped as they appear in the preset browser. */
export const systemPresets: readonly TranscodePreset[] = [
  preset("H.264", "h264-high", "匹配源 - 高比特率", build("mp4", quality(18))),
  preset(
    "H.264",
    "h264-medium",
    "匹配源 - 中等比特率",
    build("mp4", quality(23), audio("aac", 192)),
  ),
  preset(
    "H.264",
    "h264-low",
    "匹配源 - 自适应低比特率",
    build("mp4", quality(28), audio("aac", 128)),
  ),
  preset("H.264", "h264-2160p", "高质量 2160p 4K", build("mp4", quality(18), height(2160))),
  preset("H.264", "h264-1080p", "高质量 1080p HD", build("mp4", quality(20), height(1080))),
  preset(
    "H.264",
    "h264-720p",
    "高质量 720p HD",
    build("mp4", quality(21), height(720), audio("aac", 192)),
  ),
  preset(
    "H.264",
    "h264-480p",
    "高质量 480p SD",
    build("mp4", quality(22), height(480), audio("aac", 160)),
  ),
  preset(
    "H.264",
    "h264-hardware",
    "匹配源 - 硬件编码",
    build("mp4", videoCodec(hardwareH264[0]), (settings) => {
      settings.video.rateControl = "vbr";
      settings.video.bitrateKbps = 10000;
    }),
    hardwareH264,
  ),
  preset(
    "H.264",
    "h264-mkv",
    "MKV - 保留全部音轨与字幕",
    build("matroska", quality(20), (settings) => {
      settings.subtitles.mode = "copy";
    }),
  ),
  preset(
    "H.264",
    "h264-burn",
    "MP4 - 将字幕录制到视频",
    build("mp4", quality(20), (settings) => {
      settings.subtitles.mode = "burn";
    }),
  ),
  preset(
    "HEVC (H.265)",
    "hevc-high",
    "匹配源 - 高比特率",
    build("mp4", videoCodec("libx265"), quality(20)),
  ),
  preset(
    "HEVC (H.265)",
    "hevc-medium",
    "匹配源 - 中等比特率",
    build("mp4", videoCodec("libx265"), quality(26), audio("aac", 192)),
  ),
  preset(
    "HEVC (H.265)",
    "hevc-2160p",
    "高质量 2160p 4K",
    build("mp4", videoCodec("libx265"), quality(22), height(2160)),
  ),
  preset(
    "HEVC (H.265)",
    "hevc-hardware",
    "匹配源 - 硬件编码",
    build("mp4", videoCodec(hardwareHevc[0]), (settings) => {
      settings.video.rateControl = "vbr";
      settings.video.bitrateKbps = 8000;
    }),
    hardwareHevc,
  ),
  ...(
    [
      ["proxy", "Apple ProRes 422 Proxy", "0", "yuv422p10le"],
      ["lt", "Apple ProRes 422 LT", "1", "yuv422p10le"],
      ["422", "Apple ProRes 422", "2", "yuv422p10le"],
      ["hq", "Apple ProRes 422 HQ", "3", "yuv422p10le"],
      ["4444", "Apple ProRes 4444", "4", "yuva444p10le"],
    ] as const
  ).map(([id, name, value, pixelFormat]) =>
    preset(
      "Apple ProRes",
      `prores-${id}`,
      name,
      build("mov", videoCodec("prores_ks"), profile(value, pixelFormat), audio("pcm_s16le", null)),
    ),
  ),
  ...(
    [
      ["lb", "DNxHR LB", "dnxhr_lb", "yuv422p"],
      ["sq", "DNxHR SQ", "dnxhr_sq", "yuv422p"],
      ["hq", "DNxHR HQ", "dnxhr_hq", "yuv422p"],
      ["hqx", "DNxHR HQX 10 位", "dnxhr_hqx", "yuv422p10le"],
    ] as const
  ).map(([id, name, value, pixelFormat]) =>
    preset(
      "DNxHR",
      `dnxhr-${id}`,
      name,
      build("mov", videoCodec("dnxhd"), profile(value, pixelFormat), audio("pcm_s16le", null)),
    ),
  ),
  preset(
    "AV1",
    "av1-high",
    "匹配源 - 高质量 (SVT-AV1)",
    build("mp4", videoCodec("libsvtav1"), quality(28), audio("libopus", 160)),
  ),
  preset(
    "AV1",
    "av1-mkv",
    "MKV - 高质量 (SVT-AV1)",
    build("matroska", videoCodec("libsvtav1"), quality(28), audio("libopus", 160), (settings) => {
      settings.subtitles.mode = "copy";
    }),
  ),
  preset(
    "WebM",
    "webm-vp9",
    "VP9 - 匹配源",
    build("webm", videoCodec("libvpx-vp9"), quality(31), audio("libopus", 160)),
  ),
  preset(
    "WebM",
    "webm-vp9-720p",
    "VP9 - 720p",
    build("webm", videoCodec("libvpx-vp9"), quality(33), height(720), audio("libopus", 128)),
  ),
  preset("换封装（不转码）", "remux-mp4", "换封装为 MP4", build("mp4", remux)),
  preset(
    "换封装（不转码）",
    "remux-mkv",
    "换封装为 MKV",
    build("matroska", remux, (settings) => {
      settings.subtitles.mode = "copy";
    }),
  ),
  preset("换封装（不转码）", "remux-mov", "换封装为 MOV", build("mov", remux)),
  preset(
    "仅音频",
    "audio-mp3-320",
    "MP3 320 kbps",
    build("mp3", audio("libmp3lame", 320), audioOnly),
  ),
  preset(
    "仅音频",
    "audio-mp3-192",
    "MP3 192 kbps",
    build("mp3", audio("libmp3lame", 192), audioOnly),
  ),
  preset("仅音频", "audio-m4a", "AAC (M4A) 256 kbps", build("ipod", audio("aac", 256), audioOnly)),
  preset(
    "仅音频",
    "audio-wav",
    "WAV 48 kHz 16 位",
    build("wav", audio("pcm_s16le", null), audioOnly, (settings) => {
      settings.audio.sampleRate = 48000;
    }),
  ),
  preset("仅音频", "audio-flac", "FLAC 无损", build("flac", audio("flac", null), audioOnly)),
  preset("仅音频", "audio-opus", "Opus 160 kbps", build("opus", audio("libopus", 160), audioOnly)),
  preset("字幕", "subtitle-srt", "提取为 SRT", build("srt")),
  preset("字幕", "subtitle-ass", "提取为 ASS", build("ass")),
  preset("字幕", "subtitle-vtt", "提取为 WebVTT", build("webvtt")),
  preset(
    "GIF",
    "gif-480p",
    "GIF 动图 480p 15 fps",
    build("gif", height(480), (settings) => {
      settings.video.frameRate = "15";
    }),
  ),
];

export const defaultPresetId = "system:h264-high";

function encoderNames(capabilities: TranscodeCapabilities) {
  return new Set(
    [
      ...capabilities.videoEncoders,
      ...capabilities.audioEncoders,
      ...capabilities.subtitleEncoders,
    ].map((entry) => entry.name),
  );
}

/**
 * The settings a preset produces on this machine: the first available
 * candidate encoder is selected. Returns null when the installed FFmpeg
 * lacks the container or an encoder the preset needs.
 */
export function resolvePresetSettings(
  preset: TranscodePreset,
  capabilities: TranscodeCapabilities | null,
): TranscodeSettings | null {
  const settings = cloneTranscodeSettings(preset.settings);
  if (!capabilities) return settings;
  const encoders = encoderNames(capabilities);
  if (!capabilities.muxers.some((muxer) => muxer.name === settings.container)) return null;
  if (settings.exportVideo && settings.video.codec !== "copy") {
    const candidates = preset.videoCodecCandidates ?? [settings.video.codec];
    const codec = candidates.find((candidate) => encoders.has(candidate));
    if (!codec) return null;
    if (codec !== settings.video.codec) settings.video.codec = codec;
  }
  if (
    settings.exportAudio &&
    settings.audio.codec !== "copy" &&
    !encoders.has(settings.audio.codec)
  )
    return null;
  if (
    settings.exportSubtitles &&
    (settings.subtitles.mode === "convert" || settings.subtitles.mode === "sidecar") &&
    !encoders.has(settings.subtitles.codec)
  )
    return null;
  if (
    settings.exportSubtitles &&
    settings.subtitles.mode === "burn" &&
    !capabilities.filters.includes("subtitles")
  )
    return null;
  return settings;
}

export function availablePresets(
  presets: readonly TranscodePreset[],
  capabilities: TranscodeCapabilities | null,
): TranscodePreset[] {
  return presets.filter((preset) => resolvePresetSettings(preset, capabilities) !== null);
}

export const presetFileExtension = "lcpreset";

/** Reads a preset exported by this application; null when the file is not one. */
export function parsePresetFile(
  body: string,
): Pick<TranscodePreset, "name" | "settings" | "comment"> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind !== "locution-pro-transcode-preset" || typeof record.name !== "string")
      return null;
    if (typeof record.settings !== "object" || record.settings === null) return null;
    return {
      name: record.name.trim() || "导入的预设",
      comment: typeof record.comment === "string" ? record.comment : undefined,
      settings: record.settings as TranscodeSettings,
    };
  } catch {
    return null;
  }
}

export function serializePresetFile(
  preset: Pick<TranscodePreset, "name" | "settings" | "comment">,
) {
  return JSON.stringify(
    {
      kind: "locution-pro-transcode-preset",
      version: 1,
      name: preset.name,
      comment: preset.comment ?? "",
      settings: preset.settings,
    },
    null,
    2,
  );
}
