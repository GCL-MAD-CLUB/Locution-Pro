import type { MediaDocument, MediaStream } from "../../types";

export type ProxyFrameSize = "full" | "half" | "quarter" | "custom";
export type ProxyPreset =
  "remux" | "h264_mp4" | "h264_mp4_all_intra" | "h264_quicktime" | "vp8_webm" | "vp9_webm";
export type ProxyWatermark = "none";
export type ProxyLocation = "source_proxy_folder" | "custom" | "preferences_cache";

export interface ProxyCreationOptions {
  frameSize: ProxyFrameSize;
  customWidth: number;
  customHeight: number;
  preset: ProxyPreset;
  watermark: ProxyWatermark;
  location: ProxyLocation;
  customLocation: string;
}

/**
 * Video codecs macOS WKWebView (AVFoundation) plays from QuickTime. Mirrors
 * `REMUX_VIDEO_CODECS` in `src-tauri/src/backend/proxy.rs`, which re-checks
 * eligibility and falls back to the H.264 proxy.
 */
const REMUX_VIDEO_CODECS = new Set(["h264", "hevc", "prores", "mjpeg"]);

/** The backend names lossless remux outputs `<source>_Remux.mov`. */
const REMUX_PROXY_NAME = /_Remux\.mov$/iu;

export function defaultProxyOptions(preset: ProxyPreset): ProxyCreationOptions {
  return {
    frameSize: "full",
    customWidth: 1280,
    customHeight: 720,
    preset,
    watermark: "none",
    location: "source_proxy_folder",
    customLocation: "",
  };
}

/** The selected preview video stream, skipping attached cover art. */
export function proxyVideoStream(project: MediaDocument): MediaStream | undefined {
  const videoStreams = project.streams.filter((stream) => stream.codec_type === "video");
  const selectedIndex = project.asset.video_stream_index;
  return (
    (selectedIndex === null
      ? undefined
      : videoStreams.find((stream) => stream.index === selectedIndex)) ??
    videoStreams.find((stream) => !stream.disposition?.attached_pic)
  );
}

export function isRemuxEligible(project: MediaDocument | null | undefined) {
  if (!project) return false;
  const codec = proxyVideoStream(project)?.codec_name.trim().toLowerCase() ?? "";
  return REMUX_VIDEO_CODECS.has(codec);
}

export function isRemuxProxyPath(path: string | null | undefined) {
  return Boolean(path && REMUX_PROXY_NAME.test(path));
}

export function isMatroskaPath(path: string) {
  return /\.mkv$/iu.test(path);
}

/**
 * Remux targets AVFoundation (macOS WKWebView). Chromium-based previews cannot
 * play copied AC-3, ProRes or MJPEG, so other platforms are never offered it.
 */
export function canOfferRemux(project: MediaDocument | null | undefined, isMacOS: boolean) {
  return isMacOS && isRemuxEligible(project);
}

/**
 * Lossless remux is the recommended preset unless it is unavailable or a remux
 * was already made (and the dialog is open because it failed to play).
 */
export function defaultProxyPreset(
  project: MediaDocument | null | undefined,
  isMacOS: boolean,
): ProxyPreset {
  return canOfferRemux(project, isMacOS) && !isRemuxProxyPath(project?.proxy_path)
    ? "remux"
    : "h264_mp4";
}

export interface AutoRemuxContext {
  project: MediaDocument;
  isMacOS: boolean;
  enabled: boolean;
  alreadyAttempted: boolean;
}

/** macOS cannot demux Matroska, so eligible MKV sources are remuxed on first failure. */
export function shouldAutoRemux({ project, isMacOS, enabled, alreadyAttempted }: AutoRemuxContext) {
  return (
    isMacOS &&
    enabled &&
    !alreadyAttempted &&
    !project.proxy_path &&
    isMatroskaPath(project.asset.path) &&
    canOfferRemux(project, isMacOS)
  );
}

export function unplayableSourceMessage(project: MediaDocument, isMacOS: boolean) {
  return canOfferRemux(project, isMacOS)
    ? "原文件无法直接播放。推荐选择“无损重封装”代理：只复制音视频流，几秒即可完成且画质不变。"
    : "原文件无法直接播放，请先创建代理。";
}
