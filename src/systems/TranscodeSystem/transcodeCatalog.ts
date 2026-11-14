import type {
  TranscodeCapabilities,
  TranscodeCodecEntry,
  TranscodeRateControl,
  TranscodeSettings,
} from "./transcodeTypes";

export type TranscodeContainerKind = "video" | "audio" | "subtitle";

export interface TranscodeContainer {
  /** FFmpeg muxer name. */
  muxer: string;
  label: string;
  extension: string;
  kind: TranscodeContainerKind;
  /** Codec ids the container holds; null accepts everything FFmpeg offers. */
  video: readonly string[] | null;
  audio: readonly string[] | null;
  subtitles: readonly string[] | null;
}

export interface TranscodeOption {
  value: string;
  label: string;
}

export type TranscodeOptionItem = TranscodeOption | { separator: true };

const none: readonly string[] = [];

/**
 * Containers in the order they are offered: the common delivery formats
 * first, then audio-only, then subtitle files. Muxers FFmpeg provides beyond
 * this list follow alphabetically.
 */
export const commonContainers: readonly TranscodeContainer[] = [
  {
    muxer: "mp4",
    label: "MP4",
    extension: "mp4",
    kind: "video",
    video: ["h264", "hevc", "av1", "mpeg4", "vp9", "mpeg2video", "mjpeg"],
    audio: ["aac", "mp3", "ac3", "eac3", "opus", "flac", "alac", "mp2"],
    subtitles: ["mov_text"],
  },
  {
    muxer: "matroska",
    label: "MKV (Matroska)",
    extension: "mkv",
    kind: "video",
    video: null,
    audio: null,
    subtitles: ["ass", "subrip", "webvtt", "dvd_subtitle", "dvb_subtitle", "hdmv_pgs_subtitle"],
  },
  {
    muxer: "mov",
    label: "MOV (QuickTime)",
    extension: "mov",
    kind: "video",
    video: [
      "h264",
      "hevc",
      "prores",
      "dnxhd",
      "av1",
      "mjpeg",
      "mpeg4",
      "png",
      "qtrle",
      "cfhd",
      "v210",
      "rawvideo",
    ],
    audio: [
      "aac",
      "alac",
      "pcm_s16le",
      "pcm_s24le",
      "pcm_s32le",
      "pcm_f32le",
      "pcm_s16be",
      "pcm_s24be",
      "mp3",
      "ac3",
      "eac3",
    ],
    subtitles: ["mov_text"],
  },
  {
    muxer: "webm",
    label: "WebM",
    extension: "webm",
    kind: "video",
    video: ["vp9", "vp8", "av1"],
    audio: ["opus", "vorbis"],
    subtitles: ["webvtt"],
  },
  {
    muxer: "avi",
    label: "AVI",
    extension: "avi",
    kind: "video",
    video: ["mpeg4", "h264", "mjpeg", "msmpeg4v3", "mpeg2video", "ffv1", "huffyuv", "rawvideo"],
    audio: ["mp3", "ac3", "mp2", "pcm_s16le", "aac"],
    subtitles: none,
  },
  {
    muxer: "mpegts",
    label: "MPEG-TS",
    extension: "ts",
    kind: "video",
    video: ["h264", "hevc", "mpeg2video", "av1"],
    audio: ["aac", "mp2", "mp3", "ac3", "eac3", "opus"],
    subtitles: ["dvb_subtitle"],
  },
  {
    muxer: "flv",
    label: "FLV",
    extension: "flv",
    kind: "video",
    video: ["h264", "flv1"],
    audio: ["aac", "mp3"],
    subtitles: none,
  },
  {
    muxer: "mxf",
    label: "MXF",
    extension: "mxf",
    kind: "video",
    video: ["mpeg2video", "dnxhd", "h264", "prores"],
    audio: ["pcm_s16le", "pcm_s24le"],
    subtitles: none,
  },
  {
    muxer: "asf",
    label: "WMV (ASF)",
    extension: "wmv",
    kind: "video",
    video: ["wmv2", "wmv1", "msmpeg4v3"],
    audio: ["wmav2", "wmav1"],
    subtitles: none,
  },
  {
    muxer: "ogg",
    label: "OGG",
    extension: "ogv",
    kind: "video",
    video: ["theora", "vp8"],
    audio: ["vorbis", "opus", "flac"],
    subtitles: none,
  },
  {
    muxer: "gif",
    label: "GIF 动图",
    extension: "gif",
    kind: "video",
    video: ["gif"],
    audio: none,
    subtitles: none,
  },
  {
    muxer: "mp3",
    label: "MP3 音频",
    extension: "mp3",
    kind: "audio",
    video: none,
    audio: ["mp3"],
    subtitles: none,
  },
  {
    muxer: "ipod",
    label: "M4A 音频",
    extension: "m4a",
    kind: "audio",
    video: none,
    audio: ["aac", "alac"],
    subtitles: none,
  },
  {
    muxer: "wav",
    label: "WAV 音频",
    extension: "wav",
    kind: "audio",
    video: none,
    audio: ["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8"],
    subtitles: none,
  },
  {
    muxer: "flac",
    label: "FLAC 音频",
    extension: "flac",
    kind: "audio",
    video: none,
    audio: ["flac"],
    subtitles: none,
  },
  {
    muxer: "adts",
    label: "AAC 音频 (ADTS)",
    extension: "aac",
    kind: "audio",
    video: none,
    audio: ["aac"],
    subtitles: none,
  },
  {
    muxer: "opus",
    label: "Opus 音频",
    extension: "opus",
    kind: "audio",
    video: none,
    audio: ["opus"],
    subtitles: none,
  },
  {
    muxer: "ac3",
    label: "AC-3 音频",
    extension: "ac3",
    kind: "audio",
    video: none,
    audio: ["ac3"],
    subtitles: none,
  },
  {
    muxer: "aiff",
    label: "AIFF 音频",
    extension: "aiff",
    kind: "audio",
    video: none,
    audio: ["pcm_s16be", "pcm_s24be", "pcm_s32be"],
    subtitles: none,
  },
  {
    muxer: "srt",
    label: "SRT 字幕",
    extension: "srt",
    kind: "subtitle",
    video: none,
    audio: none,
    subtitles: ["subrip"],
  },
  {
    muxer: "ass",
    label: "ASS 字幕",
    extension: "ass",
    kind: "subtitle",
    video: none,
    audio: none,
    subtitles: ["ass"],
  },
  {
    muxer: "webvtt",
    label: "WebVTT 字幕",
    extension: "vtt",
    kind: "subtitle",
    video: none,
    audio: none,
    subtitles: ["webvtt"],
  },
  {
    muxer: "ttml",
    label: "TTML 字幕",
    extension: "ttml",
    kind: "subtitle",
    video: none,
    audio: none,
    subtitles: ["ttml"],
  },
  {
    muxer: "lrc",
    label: "LRC 歌词",
    extension: "lrc",
    kind: "subtitle",
    video: none,
    audio: none,
    subtitles: ["subrip", "text"],
  },
];

const containerByMuxer = new Map(commonContainers.map((container) => [container.muxer, container]));

/** Encoders in the order they are offered, with their display names. */
const videoEncoderLabels: ReadonlyArray<readonly [string, string]> = [
  ["libx264", "H.264 (x264)"],
  ["h264_videotoolbox", "H.264 (VideoToolbox 硬件)"],
  ["h264_nvenc", "H.264 (NVIDIA NVENC 硬件)"],
  ["h264_qsv", "H.264 (Intel QSV 硬件)"],
  ["h264_amf", "H.264 (AMD AMF 硬件)"],
  ["h264_mf", "H.264 (Media Foundation)"],
  ["libx265", "HEVC / H.265 (x265)"],
  ["hevc_videotoolbox", "HEVC / H.265 (VideoToolbox 硬件)"],
  ["hevc_nvenc", "HEVC / H.265 (NVIDIA NVENC 硬件)"],
  ["hevc_qsv", "HEVC / H.265 (Intel QSV 硬件)"],
  ["hevc_amf", "HEVC / H.265 (AMD AMF 硬件)"],
  ["hevc_mf", "HEVC / H.265 (Media Foundation)"],
  ["prores_ks", "Apple ProRes"],
  ["prores_videotoolbox", "Apple ProRes (VideoToolbox 硬件)"],
  ["prores", "Apple ProRes (prores)"],
  ["prores_aw", "Apple ProRes (prores_aw)"],
  ["dnxhd", "DNxHD / DNxHR"],
  ["libsvtav1", "AV1 (SVT-AV1)"],
  ["libaom-av1", "AV1 (libaom)"],
  ["librav1e", "AV1 (rav1e)"],
  ["av1_nvenc", "AV1 (NVIDIA NVENC 硬件)"],
  ["av1_qsv", "AV1 (Intel QSV 硬件)"],
  ["av1_amf", "AV1 (AMD AMF 硬件)"],
  ["libvpx-vp9", "VP9"],
  ["libvpx", "VP8"],
  ["mpeg4", "MPEG-4"],
  ["libxvid", "MPEG-4 (Xvid)"],
  ["mpeg2video", "MPEG-2"],
  ["mjpeg", "Motion JPEG"],
  ["gif", "GIF"],
  ["ffv1", "FFV1（无损）"],
  ["libtheora", "Theora"],
  ["wmv2", "WMV 8"],
  ["cfhd", "CineForm HD"],
];

const audioEncoderLabels: ReadonlyArray<readonly [string, string]> = [
  ["aac", "AAC"],
  ["aac_at", "AAC (AudioToolbox)"],
  ["libfdk_aac", "AAC (FDK)"],
  ["libmp3lame", "MP3"],
  ["libopus", "Opus"],
  ["flac", "FLAC"],
  ["alac", "ALAC (Apple Lossless)"],
  ["ac3", "AC-3（杜比数字）"],
  ["eac3", "E-AC-3（杜比数字+）"],
  ["pcm_s16le", "PCM 16 位"],
  ["pcm_s24le", "PCM 24 位"],
  ["pcm_s32le", "PCM 32 位"],
  ["pcm_f32le", "PCM 32 位浮点"],
  ["pcm_s16be", "PCM 16 位（大端）"],
  ["pcm_s24be", "PCM 24 位（大端）"],
  ["libvorbis", "Vorbis"],
  ["mp2", "MP2"],
  ["wmav2", "WMA 2"],
];

const subtitleEncoderLabels: ReadonlyArray<readonly [string, string]> = [
  ["subrip", "SRT (SubRip)"],
  ["ass", "ASS (Advanced SubStation Alpha)"],
  ["ssa", "SSA (SubStation Alpha)"],
  ["webvtt", "WebVTT"],
  ["mov_text", "MOV Text（MP4 文本字幕）"],
  ["ttml", "TTML"],
  ["text", "纯文本"],
  ["dvdsub", "DVD 字幕（位图）"],
  ["dvbsub", "DVB 字幕（位图）"],
];

/** Sidecar subtitle files: the encoder and the extension FFmpeg infers the muxer from. */
export const sidecarSubtitleFormats: ReadonlyArray<{
  extension: string;
  codec: string;
  label: string;
}> = [
  { extension: "srt", codec: "subrip", label: "SRT (.srt)" },
  { extension: "ass", codec: "ass", label: "ASS (.ass)" },
  { extension: "ssa", codec: "ssa", label: "SSA (.ssa)" },
  { extension: "vtt", codec: "webvtt", label: "WebVTT (.vtt)" },
  { extension: "ttml", codec: "ttml", label: "TTML (.ttml)" },
  { extension: "lrc", codec: "subrip", label: "LRC 歌词 (.lrc)" },
];

/** The codec id an encoder produces, e.g. `libx264` → `h264`. */
export function encoderCodecId(entry: TranscodeCodecEntry): string {
  const match = /\(codec ([\w-]+)\)\s*$/u.exec(entry.description);
  if (match) return match[1];
  // `srt` and `ssa` are encoder aliases whose listings omit the codec id.
  if (entry.name === "srt") return "subrip";
  if (entry.name === "ssa") return "ass";
  return entry.name;
}

function entriesOrFallback(
  entries: TranscodeCodecEntry[] | undefined,
  fallback: ReadonlyArray<readonly [string, string]>,
): TranscodeCodecEntry[] {
  if (entries && entries.length > 0) return entries;
  return fallback.map(([name]) => ({ name, description: "" }));
}

const fallbackCodecIds: Record<string, string> = {
  libx264: "h264",
  h264_videotoolbox: "h264",
  h264_nvenc: "h264",
  h264_qsv: "h264",
  h264_amf: "h264",
  h264_mf: "h264",
  libx265: "hevc",
  hevc_videotoolbox: "hevc",
  hevc_nvenc: "hevc",
  hevc_qsv: "hevc",
  hevc_amf: "hevc",
  hevc_mf: "hevc",
  prores_ks: "prores",
  prores_videotoolbox: "prores",
  prores_aw: "prores",
  libsvtav1: "av1",
  "libaom-av1": "av1",
  librav1e: "av1",
  av1_nvenc: "av1",
  av1_qsv: "av1",
  av1_amf: "av1",
  "libvpx-vp9": "vp9",
  libvpx: "vp8",
  libxvid: "mpeg4",
  libtheora: "theora",
  aac_at: "aac",
  libfdk_aac: "aac",
  libmp3lame: "mp3",
  libopus: "opus",
  libvorbis: "vorbis",
  dvdsub: "dvd_subtitle",
  dvbsub: "dvb_subtitle",
  ssa: "ass",
  srt: "subrip",
};

function codecIdOf(entry: TranscodeCodecEntry) {
  return entry.description ? encoderCodecId(entry) : (fallbackCodecIds[entry.name] ?? entry.name);
}

export function findContainer(muxer: string): TranscodeContainer | null {
  return containerByMuxer.get(muxer) ?? null;
}

function withSeparator(
  common: TranscodeOption[],
  others: TranscodeOption[],
): TranscodeOptionItem[] {
  return common.length > 0 && others.length > 0
    ? [...common, { separator: true }, ...others]
    : [...common, ...others];
}

/**
 * Every container the installed FFmpeg can write: common formats first in
 * catalog order, then the remaining muxers alphabetically. Without
 * capabilities (browser preview) the catalog alone is offered.
 */
export function containerOptions(
  capabilities: TranscodeCapabilities | null,
): TranscodeOptionItem[] {
  if (!capabilities) {
    return commonContainers.map((container) => ({
      value: container.muxer,
      label: container.label,
    }));
  }
  const available = new Map(capabilities.muxers.map((muxer) => [muxer.name, muxer]));
  const common = commonContainers
    .filter((container) => available.has(container.muxer))
    .map((container) => ({ value: container.muxer, label: container.label }));
  const others = capabilities.muxers
    .filter((muxer) => !containerByMuxer.has(muxer.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((muxer) => ({
      value: muxer.name,
      label: muxer.description ? `${muxer.name} — ${muxer.description}` : muxer.name,
    }));
  return withSeparator(common, others);
}

function encoderOptions(
  entries: TranscodeCodecEntry[],
  labels: ReadonlyArray<readonly [string, string]>,
  accepted: readonly string[] | null,
): TranscodeOptionItem[] {
  const labelByName = new Map(labels);
  const order = new Map(labels.map(([name], index) => [name, index]));
  const usable = entries.filter(
    (entry) => accepted === null || accepted.includes(codecIdOf(entry)),
  );
  const common = usable
    .filter((entry) => order.has(entry.name))
    .sort((left, right) => (order.get(left.name) ?? 0) - (order.get(right.name) ?? 0))
    .map((entry) => ({ value: entry.name, label: labelByName.get(entry.name) ?? entry.name }));
  const others = usable
    .filter((entry) => !order.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      value: entry.name,
      label: entry.description ? `${entry.name} — ${entry.description}` : entry.name,
    }));
  return withSeparator(common, others);
}

const copyOption: TranscodeOption = { value: "copy", label: "流复制（不重新编码）" };

function appendCopy(items: TranscodeOptionItem[]): TranscodeOptionItem[] {
  return items.length > 0 ? [...items, { separator: true }, copyOption] : [copyOption];
}

export function videoEncoderOptions(
  capabilities: TranscodeCapabilities | null,
  muxer: string,
): TranscodeOptionItem[] {
  const container = findContainer(muxer);
  return appendCopy(
    encoderOptions(
      entriesOrFallback(capabilities?.videoEncoders, videoEncoderLabels),
      videoEncoderLabels,
      container ? container.video : null,
    ),
  );
}

export function audioEncoderOptions(
  capabilities: TranscodeCapabilities | null,
  muxer: string,
): TranscodeOptionItem[] {
  const container = findContainer(muxer);
  return appendCopy(
    encoderOptions(
      entriesOrFallback(capabilities?.audioEncoders, audioEncoderLabels),
      audioEncoderLabels,
      container ? container.audio : null,
    ),
  );
}

/** Subtitle encoders the container can hold; `srt` is listed once as `subrip`. */
export function subtitleEncoderOptions(
  capabilities: TranscodeCapabilities | null,
  muxer: string,
): TranscodeOptionItem[] {
  const container = findContainer(muxer);
  const entries = entriesOrFallback(capabilities?.subtitleEncoders, subtitleEncoderLabels).filter(
    (entry) => entry.name !== "srt",
  );
  return encoderOptions(entries, subtitleEncoderLabels, container ? container.subtitles : null);
}

export function optionValues(items: TranscodeOptionItem[]): string[] {
  return items.flatMap((item) => ("separator" in item ? [] : [item.value]));
}

export function containerSupports(muxer: string, stream: "video" | "audio" | "subtitles") {
  const container = findContainer(muxer);
  if (!container) return true;
  const accepted = container[stream];
  return accepted === null || accepted.length > 0;
}

export interface VideoEncoderTraits {
  quality: { min: number; max: number; fallback: number; label: string } | null;
  bitrate: boolean;
  twoPass: boolean;
  speedPresets: TranscodeOption[];
  defaultSpeedPreset: string | null;
  profiles: TranscodeOption[];
  levels: string[];
}

const x26xPresets: TranscodeOption[] = [
  ["ultrafast", "最快 (ultrafast)"],
  ["superfast", "超快 (superfast)"],
  ["veryfast", "很快 (veryfast)"],
  ["faster", "较快 (faster)"],
  ["fast", "快 (fast)"],
  ["medium", "均衡 (medium)"],
  ["slow", "慢 (slow)"],
  ["slower", "较慢 (slower)"],
  ["veryslow", "很慢，质量最佳 (veryslow)"],
].map(([value, label]) => ({ value, label }));

const h264Levels = ["3.0", "3.1", "4.0", "4.1", "4.2", "5.0", "5.1", "5.2", "6.0", "6.1", "6.2"];

function numbered(from: number, to: number, describe: (value: number) => string) {
  const options: TranscodeOption[] = [];
  for (let value = from; value <= to; value += 1) {
    options.push({ value: String(value), label: describe(value) });
  }
  return options;
}

const genericTraits: VideoEncoderTraits = {
  quality: { min: 1, max: 31, fallback: 4, label: "质量 (qscale)" },
  bitrate: true,
  twoPass: false,
  speedPresets: [],
  defaultSpeedPreset: null,
  profiles: [],
  levels: [],
};

const profileOnlyTraits: VideoEncoderTraits = {
  ...genericTraits,
  quality: null,
  bitrate: false,
};

/** What each encoder exposes in the video settings. */
export function videoEncoderTraits(codec: string): VideoEncoderTraits {
  if (codec === "copy") return profileOnlyTraits;
  if (codec === "libx264") {
    return {
      quality: { min: 0, max: 51, fallback: 20, label: "CRF" },
      bitrate: true,
      twoPass: true,
      speedPresets: x26xPresets,
      defaultSpeedPreset: "medium",
      profiles: [
        { value: "baseline", label: "基线 (Baseline)" },
        { value: "main", label: "主要 (Main)" },
        { value: "high", label: "高 (High)" },
        { value: "high10", label: "High 10" },
        { value: "high422", label: "High 4:2:2" },
        { value: "high444", label: "High 4:4:4" },
      ],
      levels: h264Levels,
    };
  }
  if (codec === "libx265") {
    return {
      quality: { min: 0, max: 51, fallback: 24, label: "CRF" },
      bitrate: true,
      twoPass: false,
      speedPresets: x26xPresets,
      defaultSpeedPreset: "medium",
      profiles: [
        { value: "main", label: "主要 (Main)" },
        { value: "main10", label: "Main 10" },
      ],
      levels: [],
    };
  }
  if (codec === "libvpx-vp9" || codec === "libvpx") {
    return {
      quality: { min: 0, max: 63, fallback: 31, label: "CRF" },
      bitrate: true,
      twoPass: true,
      speedPresets: numbered(0, 8, (value) =>
        value === 0 ? "0（最慢，质量最佳）" : value === 8 ? "8（最快）" : String(value),
      ),
      defaultSpeedPreset: "2",
      profiles: [],
      levels: [],
    };
  }
  if (codec === "libsvtav1") {
    return {
      quality: { min: 0, max: 63, fallback: 30, label: "CRF" },
      bitrate: true,
      twoPass: false,
      speedPresets: numbered(0, 13, (value) =>
        value === 0 ? "0（最慢，质量最佳）" : value === 13 ? "13（最快）" : String(value),
      ),
      defaultSpeedPreset: "8",
      profiles: [],
      levels: [],
    };
  }
  if (codec === "libaom-av1" || codec === "librav1e") {
    return {
      quality: { min: 0, max: 63, fallback: 30, label: codec === "librav1e" ? "QP" : "CRF" },
      bitrate: true,
      twoPass: false,
      speedPresets: numbered(0, codec === "librav1e" ? 10 : 8, String),
      defaultSpeedPreset: "6",
      profiles: [],
      levels: [],
    };
  }
  if (codec.endsWith("_videotoolbox")) {
    if (codec.startsWith("prores")) {
      return { ...profileOnlyTraits, profiles: proresProfiles };
    }
    return {
      quality: { min: 1, max: 100, fallback: 65, label: "质量（越高越好）" },
      bitrate: true,
      twoPass: false,
      speedPresets: [],
      defaultSpeedPreset: null,
      profiles: codec.startsWith("h264")
        ? [
            { value: "baseline", label: "基线 (Baseline)" },
            { value: "main", label: "主要 (Main)" },
            { value: "high", label: "高 (High)" },
          ]
        : [
            { value: "main", label: "主要 (Main)" },
            { value: "main10", label: "Main 10" },
          ],
      levels: [],
    };
  }
  if (codec.endsWith("_nvenc")) {
    return {
      quality: { min: 0, max: 51, fallback: 23, label: "CQ" },
      bitrate: true,
      twoPass: false,
      speedPresets: numbered(1, 7, (value) =>
        value === 1 ? "p1（最快）" : value === 7 ? "p7（质量最佳）" : `p${value}`,
      ).map((option) => ({ ...option, value: `p${option.value}` })),
      defaultSpeedPreset: "p5",
      profiles: [],
      levels: [],
    };
  }
  if (codec.endsWith("_qsv")) {
    return {
      quality: { min: 1, max: 51, fallback: 23, label: "全局质量" },
      bitrate: true,
      twoPass: false,
      speedPresets: x26xPresets.filter((preset) =>
        ["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].includes(
          preset.value,
        ),
      ),
      defaultSpeedPreset: "medium",
      profiles: [],
      levels: [],
    };
  }
  if (codec.endsWith("_amf")) {
    return {
      quality: { min: 0, max: 51, fallback: 23, label: "QP" },
      bitrate: true,
      twoPass: false,
      speedPresets: [
        { value: "speed", label: "速度优先" },
        { value: "balanced", label: "均衡" },
        { value: "quality", label: "质量优先" },
      ],
      defaultSpeedPreset: "balanced",
      profiles: [],
      levels: [],
    };
  }
  if (codec === "prores_ks" || codec === "prores" || codec === "prores_aw") {
    return { ...profileOnlyTraits, profiles: proresProfiles };
  }
  if (codec === "dnxhd") {
    return {
      ...profileOnlyTraits,
      profiles: [
        { value: "dnxhr_lb", label: "DNxHR LB（低码率）" },
        { value: "dnxhr_sq", label: "DNxHR SQ（标准质量）" },
        { value: "dnxhr_hq", label: "DNxHR HQ（高质量）" },
        { value: "dnxhr_hqx", label: "DNxHR HQX（10 位高质量）" },
        { value: "dnxhr_444", label: "DNxHR 444" },
      ],
    };
  }
  if (["gif", "ffv1", "huffyuv", "rawvideo", "png", "qtrle", "v210", "utvideo"].includes(codec)) {
    return profileOnlyTraits;
  }
  if (["mpeg4", "libxvid", "mpeg2video", "mpeg1video"].includes(codec)) {
    return { ...genericTraits, twoPass: true };
  }
  return genericTraits;
}

const proresProfiles: TranscodeOption[] = [
  { value: "0", label: "ProRes 422 Proxy" },
  { value: "1", label: "ProRes 422 LT" },
  { value: "2", label: "ProRes 422" },
  { value: "3", label: "ProRes 422 HQ" },
  { value: "4", label: "ProRes 4444" },
  { value: "5", label: "ProRes 4444 XQ" },
];

export function rateControlOptions(codec: string): TranscodeOption[] {
  const traits = videoEncoderTraits(codec);
  const options: Array<[TranscodeRateControl, string]> = [];
  if (!traits.quality && !traits.bitrate) return [{ value: "auto", label: "编码器默认" }];
  if (traits.quality) options.push(["quality", `恒定质量 (${traits.quality.label})`]);
  if (traits.bitrate) {
    options.push(["vbr", "VBR，1 次"]);
    if (traits.twoPass) options.push(["twoPass", "VBR，2 次"]);
    options.push(["cbr", "CBR"]);
  }
  options.push(["auto", "编码器默认"]);
  return options.map(([value, label]) => ({ value, label }));
}

/** Audio encoders whose output size is not set by a bitrate. */
export function audioEncoderUsesBitrate(codec: string) {
  return !(
    codec === "copy" ||
    codec === "flac" ||
    codec === "alac" ||
    codec.startsWith("pcm_") ||
    codec === "wavpack" ||
    codec === "tta"
  );
}

export const frameRateOptions: TranscodeOption[] = [
  { value: "", label: "匹配源" },
  { value: "24000/1001", label: "23.976" },
  { value: "24", label: "24" },
  { value: "25", label: "25" },
  { value: "30000/1001", label: "29.97" },
  { value: "30", label: "30" },
  { value: "48", label: "48" },
  { value: "50", label: "50" },
  { value: "60000/1001", label: "59.94" },
  { value: "60", label: "60" },
  { value: "120", label: "120" },
  { value: "15", label: "15" },
  { value: "12", label: "12" },
  { value: "10", label: "10" },
];

export const sampleRateOptions: TranscodeOption[] = [
  { value: "", label: "匹配源" },
  { value: "48000", label: "48000 Hz" },
  { value: "44100", label: "44100 Hz" },
  { value: "96000", label: "96000 Hz" },
  { value: "88200", label: "88200 Hz" },
  { value: "32000", label: "32000 Hz" },
  { value: "24000", label: "24000 Hz" },
  { value: "22050", label: "22050 Hz" },
  { value: "16000", label: "16000 Hz" },
];

export const channelOptions: TranscodeOption[] = [
  { value: "", label: "匹配源" },
  { value: "2", label: "立体声" },
  { value: "1", label: "单声道" },
  { value: "6", label: "5.1" },
  { value: "8", label: "7.1" },
];

export const audioBitrateOptions: TranscodeOption[] = [
  "320",
  "256",
  "192",
  "160",
  "128",
  "96",
  "64",
  "448",
  "640",
].map((value) => ({ value, label: `${value} kbps` }));

/** Common pixel formats first; the encoder's remaining formats follow. */
const pixelFormatPriority = [
  "yuv420p",
  "yuv420p10le",
  "yuv422p",
  "yuv422p10le",
  "yuv444p",
  "yuv444p10le",
  "yuva444p10le",
  "nv12",
  "p010le",
  "rgb24",
  "bgr0",
];

const pixelFormatLabels: Record<string, string> = {
  yuv420p: "YUV 4:2:0 8 位 (yuv420p)",
  yuv420p10le: "YUV 4:2:0 10 位 (yuv420p10le)",
  yuv422p: "YUV 4:2:2 8 位 (yuv422p)",
  yuv422p10le: "YUV 4:2:2 10 位 (yuv422p10le)",
  yuv444p: "YUV 4:4:4 8 位 (yuv444p)",
  yuv444p10le: "YUV 4:4:4 10 位 (yuv444p10le)",
  yuva444p10le: "YUV 4:4:4 10 位 + Alpha (yuva444p10le)",
};

export function pixelFormatOptions(supported: readonly string[]): TranscodeOptionItem[] {
  const formats = supported.length > 0 ? supported : pixelFormatPriority.slice(0, 6);
  const common = pixelFormatPriority
    .filter((format) => formats.includes(format))
    .map((format) => ({ value: format, label: pixelFormatLabels[format] ?? format }));
  const others = formats
    .filter((format) => !pixelFormatPriority.includes(format))
    .map((format) => ({ value: format, label: format }));
  return [{ value: "", label: "自动" }, { separator: true }, ...withSeparator(common, others)];
}

function firstValue(items: TranscodeOptionItem[], preferred: string) {
  const values = optionValues(items);
  return values.includes(preferred) ? preferred : (values[0] ?? preferred);
}

/**
 * Switches the container and repairs whatever the new one cannot hold, so a
 * format change always leaves settings FFmpeg can mux.
 */
export function applyContainer(
  settings: TranscodeSettings,
  muxer: string,
  capabilities: TranscodeCapabilities | null,
  extension?: string,
): TranscodeSettings {
  const container = findContainer(muxer);
  const next: TranscodeSettings = structuredClone(settings);
  next.container = muxer;
  next.extension = container?.extension ?? extension ?? muxer;

  const hasVideo = containerSupports(muxer, "video");
  const hasAudio = containerSupports(muxer, "audio");
  const hasSubtitles = containerSupports(muxer, "subtitles");
  const wasSubtitleFile = findContainer(settings.container)?.kind === "subtitle";
  next.exportVideo =
    hasVideo && (settings.exportVideo || !containerSupports(settings.container, "video"));
  next.exportAudio =
    hasAudio && (settings.exportAudio || !containerSupports(settings.container, "audio"));

  if (next.exportVideo) {
    const options = videoEncoderOptions(capabilities, muxer);
    if (!optionValues(options).includes(next.video.codec)) {
      next.video = retargetVideoCodec(next.video, firstValue(options, "libx264"));
    }
  }
  if (next.exportAudio) {
    const options = audioEncoderOptions(capabilities, muxer);
    if (!optionValues(options).includes(next.audio.codec)) {
      next.audio.codec = firstValue(options, "aac");
    }
  }

  if (container?.kind === "subtitle") {
    next.exportSubtitles = true;
    next.subtitles.mode = "convert";
    next.subtitles.codec = firstValue(subtitleEncoderOptions(capabilities, muxer), "subrip");
  } else if (!hasSubtitles) {
    // Burned and sidecar subtitles do not need a subtitle stream in the file.
    if (next.subtitles.mode === "copy" || next.subtitles.mode === "convert") {
      next.subtitles.mode = "sidecar";
      next.exportSubtitles = false;
    }
  } else {
    if (wasSubtitleFile) next.exportSubtitles = true;
    const options = optionValues(subtitleEncoderOptions(capabilities, muxer));
    if (next.subtitles.mode === "copy" && container && container.muxer !== "matroska") {
      // A limited container cannot hold arbitrary source subtitle codecs.
      next.subtitles.mode = "convert";
    }
    if (next.subtitles.mode === "convert" && !options.includes(next.subtitles.codec)) {
      next.subtitles.codec = options[0] ?? next.subtitles.codec;
    }
  }
  return next;
}

/** Changes the video encoder and resets the options that are encoder-specific. */
export function retargetVideoCodec(
  video: TranscodeSettings["video"],
  codec: string,
): TranscodeSettings["video"] {
  const traits = videoEncoderTraits(codec);
  const rateOptions = rateControlOptions(codec).map((option) => option.value);
  const rateControl = rateOptions.includes(video.rateControl)
    ? video.rateControl
    : (rateOptions[0] as TranscodeRateControl);
  const quality = traits.quality
    ? video.quality >= traits.quality.min &&
      video.quality <= traits.quality.max &&
      videoEncoderTraits(video.codec).quality?.label === traits.quality.label
      ? video.quality
      : traits.quality.fallback
    : video.quality;
  return {
    ...video,
    codec,
    rateControl,
    quality,
    speedPreset: traits.defaultSpeedPreset,
    profile:
      traits.profiles.some((profile) => profile.value === video.profile) && video.profile
        ? video.profile
        : codec.startsWith("prores") || codec === "dnxhd"
          ? (traits.profiles[2]?.value ?? null)
          : null,
    level: video.level && traits.levels.includes(video.level) ? video.level : null,
    pixelFormat:
      codec === "copy"
        ? null
        : codec === video.codec
          ? video.pixelFormat
          : defaultPixelFormat(codec),
  };
}

function defaultPixelFormat(codec: string): string | null {
  if (codec.startsWith("prores")) return "yuv422p10le";
  if (codec === "dnxhd") return "yuv422p";
  if (codec === "gif" || codec === "copy") return null;
  if (codec.startsWith("libx264") || codec.startsWith("h264_")) return "yuv420p";
  return null;
}

export const overlayPositionOptions: TranscodeOption[] = [
  { value: "topLeft", label: "左上" },
  { value: "topCenter", label: "中上" },
  { value: "topRight", label: "右上" },
  { value: "centerLeft", label: "左中" },
  { value: "center", label: "中置" },
  { value: "centerRight", label: "右中" },
  { value: "bottomLeft", label: "左下" },
  { value: "bottomCenter", label: "中下" },
  { value: "bottomRight", label: "右下" },
];

export function containerLabel(muxer: string) {
  return findContainer(muxer)?.label ?? muxer;
}

function labelFrom(labels: ReadonlyArray<readonly [string, string]>, codec: string) {
  if (codec === "copy") return "流复制";
  return labels.find(([name]) => name === codec)?.[1] ?? codec;
}

export function videoEncoderLabel(codec: string) {
  return labelFrom(videoEncoderLabels, codec);
}

export function audioEncoderLabel(codec: string) {
  return labelFrom(audioEncoderLabels, codec);
}

export function subtitleEncoderLabel(codec: string) {
  return labelFrom(subtitleEncoderLabels, codec);
}

/** Effects need these FFmpeg filters; unsupported ones are not offered. */
export const effectFilters = {
  toneMapping: ["zscale", "tonemap"],
  lut: ["lut3d"],
  imageOverlay: ["overlay"],
  textOverlay: ["drawtext"],
  timecodeOverlay: ["drawtext"],
  timeTuner: ["setpts", "atempo"],
  videoLimiter: ["limiter"],
  loudness: ["loudnorm"],
  burnText: ["subtitles"],
  deinterlace: ["bwdif"],
} as const;

export type TranscodeEffectKey = keyof typeof effectFilters;

export function effectAvailable(
  capabilities: TranscodeCapabilities | null,
  effect: TranscodeEffectKey,
) {
  if (!capabilities) return true;
  return effectFilters[effect].every((filter) => capabilities.filters.includes(filter));
}
