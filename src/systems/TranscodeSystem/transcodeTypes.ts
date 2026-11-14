export type TranscodeScaling = "fit" | "fill" | "stretch";
export type TranscodeRateControl = "auto" | "quality" | "vbr" | "cbr" | "twoPass";
export type TranscodeAudioTracks = "all" | "first";
export type TranscodeSubtitleMode = "copy" | "convert" | "burn" | "sidecar";
export type TranscodeOverlayPosition =
  | "topLeft"
  | "topCenter"
  | "topRight"
  | "centerLeft"
  | "center"
  | "centerRight"
  | "bottomLeft"
  | "bottomCenter"
  | "bottomRight";
export type TranscodeTextContent = "none" | "sourceName" | "outputName";

export interface TranscodeVideoSettings {
  /** FFmpeg encoder name, or `copy` to keep the source stream. */
  codec: string;
  width: number | null;
  height: number | null;
  scaling: TranscodeScaling;
  frameRate: string | null;
  pixelFormat: string | null;
  profile: string | null;
  level: string | null;
  speedPreset: string | null;
  rateControl: TranscodeRateControl;
  quality: number;
  bitrateKbps: number;
  maxBitrateKbps: number;
  keyframeInterval: number | null;
  deinterlace: boolean;
}

export interface TranscodeAudioSettings {
  codec: string;
  sampleRate: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  tracks: TranscodeAudioTracks;
}

export interface TranscodeSubtitleSettings {
  mode: TranscodeSubtitleMode;
  codec: string;
  sidecarExtension: string;
  /** Zero-based index among the source subtitle streams; null selects all. */
  stream: number | null;
  externalPath: string;
}

export interface TranscodeEffects {
  toneMapping: { enabled: boolean; algorithm: string };
  lut: { enabled: boolean; path: string };
  imageOverlay: {
    enabled: boolean;
    path: string;
    position: TranscodeOverlayPosition;
    offsetX: number;
    offsetY: number;
    scalePercent: number;
    opacityPercent: number;
  };
  textOverlay: {
    enabled: boolean;
    prefix: string;
    content: TranscodeTextContent;
    suffix: string;
    position: TranscodeOverlayPosition;
    sizePercent: number;
    opacityPercent: number;
  };
  timecodeOverlay: {
    enabled: boolean;
    position: TranscodeOverlayPosition;
    sizePercent: number;
    opacityPercent: number;
  };
  timeTuner: { enabled: boolean; durationChangePercent: number };
  videoLimiter: { enabled: boolean; clipLevelIre: number };
  loudness: { enabled: boolean; targetLufs: number; rangeLu: number; truePeakDb: number };
}

/** Mirrors the backend `TranscodeSettings` contract. */
export interface TranscodeSettings {
  /** FFmpeg muxer name. */
  container: string;
  extension: string;
  exportVideo: boolean;
  exportAudio: boolean;
  exportSubtitles: boolean;
  comment: string;
  video: TranscodeVideoSettings;
  audio: TranscodeAudioSettings;
  subtitles: TranscodeSubtitleSettings;
  fastStart: boolean;
  effects: TranscodeEffects;
  rangeStartUs: number | null;
  rangeEndUs: number | null;
  hardwareDecode: boolean;
  extraArgs: string;
}

/**
 * Where a finished output goes. The choice is required and made by the user:
 * a folder on disk, or the project's `encoder` media bin.
 */
export type TranscodeDestination = { kind: "folder"; directory: string } | { kind: "mediaBin" };

export interface TranscodeCodecEntry {
  name: string;
  description: string;
}

export interface TranscodeCapabilities {
  version: string;
  muxers: TranscodeCodecEntry[];
  videoEncoders: TranscodeCodecEntry[];
  audioEncoders: TranscodeCodecEntry[];
  subtitleEncoders: TranscodeCodecEntry[];
  filters: string[];
}

export interface TranscodeCodecDetails {
  name: string;
  extensions: string[];
  defaultVideoCodec: string | null;
  defaultAudioCodec: string | null;
  defaultSubtitleCodec: string | null;
  pixelFormats: string[];
  sampleRates: number[];
  channelLayouts: string[];
}

export interface TranscodeSourceStream {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  frameRate: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitmap: boolean;
}

export interface TranscodeSourceInfo {
  durationUs: number;
  video: TranscodeSourceStream[];
  audio: TranscodeSourceStream[];
  subtitles: TranscodeSourceStream[];
}

export interface TranscodeResult {
  outputPath: string;
  sidecarPaths: string[];
}

export interface TranscodePreset {
  id: string;
  name: string;
  group: string;
  system: boolean;
  comment?: string;
  settings: TranscodeSettings;
  /**
   * Encoders tried in order when the preset is applied; the first one the
   * installed FFmpeg provides replaces `settings.video.codec`.
   */
  videoCodecCandidates?: string[];
}

export type TranscodeOutputStatus = "ready" | "encoding" | "done" | "failed" | "stopped";

export interface TranscodeOutput {
  id: string;
  presetId: string | null;
  presetName: string;
  settings: TranscodeSettings;
  destination: TranscodeDestination | null;
  /** Output file name without its extension. */
  outputName: string;
  status: TranscodeOutputStatus;
  progress: number;
  outputPath: string | null;
  /** Stable error code and log reference of the last failure. */
  failure: { code: string; errorId: string } | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TranscodeSource {
  id: string;
  path: string;
  info: TranscodeSourceInfo | null;
  infoStatus: "pending" | "ready" | "failed";
  watchFolderId: string | null;
  outputs: TranscodeOutput[];
}

export interface TranscodeWatchFolder {
  id: string;
  path: string;
  presetId: string | null;
  presetName: string;
  settings: TranscodeSettings;
  destination: TranscodeDestination;
  /** `path|size` keys of files already sent to the queue. */
  processed: string[];
}

export function defaultTranscodeEffects(): TranscodeEffects {
  return {
    toneMapping: { enabled: false, algorithm: "hable" },
    lut: { enabled: false, path: "" },
    imageOverlay: {
      enabled: false,
      path: "",
      position: "center",
      offsetX: 0,
      offsetY: 0,
      scalePercent: 100,
      opacityPercent: 100,
    },
    textOverlay: {
      enabled: false,
      prefix: "",
      content: "sourceName",
      suffix: "",
      position: "topCenter",
      sizePercent: 4,
      opacityPercent: 100,
    },
    timecodeOverlay: {
      enabled: false,
      position: "bottomCenter",
      sizePercent: 4,
      opacityPercent: 100,
    },
    timeTuner: { enabled: false, durationChangePercent: 0 },
    videoLimiter: { enabled: false, clipLevelIre: 103 },
    loudness: { enabled: false, targetLufs: -24, rangeLu: 7, truePeakDb: -2 },
  };
}

/** H.264 + AAC in MP4, matching the source size and frame rate. */
export function defaultTranscodeSettings(): TranscodeSettings {
  return {
    container: "mp4",
    extension: "mp4",
    exportVideo: true,
    exportAudio: true,
    exportSubtitles: true,
    comment: "",
    video: {
      codec: "libx264",
      width: null,
      height: null,
      scaling: "fit",
      frameRate: null,
      pixelFormat: "yuv420p",
      profile: null,
      level: null,
      speedPreset: "medium",
      rateControl: "quality",
      quality: 20,
      bitrateKbps: 10000,
      maxBitrateKbps: 0,
      keyframeInterval: null,
      deinterlace: false,
    },
    audio: { codec: "aac", sampleRate: null, channels: null, bitrateKbps: 320, tracks: "all" },
    subtitles: {
      mode: "convert",
      codec: "mov_text",
      sidecarExtension: "srt",
      stream: null,
      externalPath: "",
    },
    fastStart: true,
    effects: defaultTranscodeEffects(),
    rangeStartUs: null,
    rangeEndUs: null,
    hardwareDecode: false,
    extraArgs: "",
  };
}

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDefaults<T>(defaults: T, value: unknown): T {
  if (!isRecord(defaults)) {
    if (value === undefined) return defaults;
    if (defaults === null || value === null) return value as T;
    return typeof value === typeof defaults ? (value as T) : defaults;
  }
  const source = isRecord(value) ? value : {};
  const result: Loose = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    result[key] = mergeDefaults(fallback, source[key]);
  }
  return result as T;
}

/** Restores stored or imported settings onto the current shape. */
export function normalizeTranscodeSettings(value: unknown): TranscodeSettings {
  return mergeDefaults(defaultTranscodeSettings(), value);
}

export function cloneTranscodeSettings(settings: TranscodeSettings): TranscodeSettings {
  return structuredClone(settings);
}
