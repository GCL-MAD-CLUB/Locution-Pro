import { audioEncoderLabel, containerLabel, videoEncoderLabel } from "./transcodeCatalog";
import type {
  TranscodeDestination,
  TranscodeOutput,
  TranscodeSettings,
  TranscodeSource,
  TranscodeSourceInfo,
} from "./transcodeTypes";

/** Media-bin folder, and on-disk folder name, that receives project outputs. */
export const encoderBinName = "encoder";

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function fileStem(path: string) {
  const name = fileName(path);
  const separator = name.lastIndexOf(".");
  return separator > 0 ? name.slice(0, separator) : name;
}

export function parentDirectory(path: string) {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (separator < 0) return "";
  // Keep the root itself: "/" or "C:\".
  return separator === 0 || /^[a-z]:$/iu.test(trimmed.slice(0, separator))
    ? trimmed.slice(0, separator + 1)
    : trimmed.slice(0, separator);
}

export function joinPath(directory: string, name: string) {
  if (!directory) return name;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return /[\\/]$/u.test(directory) ? `${directory}${name}` : `${directory}${separator}${name}`;
}

/**
 * The folder an output is written to. Project outputs live in an `encoder`
 * folder beside the project file, or beside the source until the project has
 * been saved.
 */
export function resolveOutputDirectory(
  destination: TranscodeDestination | null,
  sourcePath: string,
  projectDirectory: string,
): string | null {
  if (!destination) return null;
  if (destination.kind === "folder") return destination.directory.trim() || null;
  const base = projectDirectory || parentDirectory(sourcePath);
  return base ? joinPath(base, encoderBinName) : null;
}

/** Why an output cannot be encoded yet; null when it is ready to run. */
export function outputBlocker(output: TranscodeOutput): string | null {
  if (!output.destination) return "请选择输出位置";
  if (output.destination.kind === "folder" && !output.destination.directory.trim())
    return "请选择输出文件夹";
  if (!output.outputName.trim()) return "请填写输出名称";
  const { settings } = output;
  if (!settings.exportVideo && !settings.exportAudio && !settings.exportSubtitles)
    return "请至少导出视频、音频或字幕之一";
  return null;
}

export function destinationLabel(destination: TranscodeDestination | null) {
  if (!destination) return "未选择输出位置";
  return destination.kind === "mediaBin"
    ? `项目媒体箱 / ${encoderBinName}`
    : destination.directory || "未选择输出文件夹";
}

export function plannedOutputPath(
  output: TranscodeOutput,
  source: TranscodeSource,
  projectDirectory: string,
) {
  if (output.outputPath) return output.outputPath;
  const directory = resolveOutputDirectory(output.destination, source.path, projectDirectory);
  const name = `${output.outputName.trim() || fileStem(source.path)}.${output.settings.extension}`;
  return directory ? joinPath(directory, name) : name;
}

export function formatDuration(microseconds: number) {
  const totalSeconds = Math.max(0, Math.round(microseconds / 1_000_000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Parses `HH:MM:SS.mmm`, `MM:SS` or seconds; null for an empty or invalid value. */
export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/u.test(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000_000) : null;
}

export function formatTimecode(microseconds: number | null) {
  if (microseconds === null) return "";
  const milliseconds = Math.round(microseconds / 1000);
  const base = formatDuration(Math.floor(milliseconds / 1000) * 1_000_000);
  const fraction = milliseconds % 1000;
  return fraction ? `${base}.${String(fraction).padStart(3, "0")}` : base;
}

export function formatFrameRate(rate: string | null | undefined) {
  if (!rate) return "";
  const [numerator, denominator = "1"] = rate.split("/");
  const value = Number(numerator) / Number(denominator);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${Number(value.toFixed(3))} fps`;
}

function channelLabel(channels: number | null) {
  if (channels === 1) return "单声道";
  if (channels === 2) return "立体声";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return channels ? `${channels} 声道` : "";
}

/** One line per stream type describing the source, as shown in the summary. */
export function sourceSummary(info: TranscodeSourceInfo | null): string[] {
  if (!info) return [];
  const lines: string[] = [];
  const video = info.video[0];
  if (video) {
    lines.push(
      [
        video.width && video.height ? `${video.width}x${video.height}` : "",
        formatFrameRate(video.frameRate),
        video.codec,
        info.durationUs > 0 ? formatDuration(info.durationUs) : "",
      ]
        .filter(Boolean)
        .join("，"),
    );
  }
  const audio = info.audio[0];
  lines.push(
    audio
      ? [
          audio.codec,
          audio.sampleRate ? `${audio.sampleRate} Hz` : "",
          channelLabel(audio.channels),
          info.audio.length > 1 ? `共 ${info.audio.length} 条音轨` : "",
        ]
          .filter(Boolean)
          .join("，")
      : "无音频",
  );
  if (info.subtitles.length > 0) {
    lines.push(
      `${info.subtitles.length} 条字幕（${[...new Set(info.subtitles.map((stream) => stream.codec))].join("、")}）`,
    );
  }
  return lines;
}

function rateSummary(settings: TranscodeSettings) {
  const { video } = settings;
  switch (video.rateControl) {
    case "quality":
      return `恒定质量 ${video.quality}`;
    case "vbr":
      return `VBR，1 次，目标 ${(video.bitrateKbps / 1000).toFixed(2)} Mbps`;
    case "twoPass":
      return `VBR，2 次，目标 ${(video.bitrateKbps / 1000).toFixed(2)} Mbps`;
    case "cbr":
      return `CBR ${(video.bitrateKbps / 1000).toFixed(2)} Mbps`;
    default:
      return "";
  }
}

/** One line per exported stream type describing the output settings. */
export function outputSummary(settings: TranscodeSettings, info: TranscodeSourceInfo | null) {
  const lines: string[] = [];
  // Once the source is read, streams it does not have are left out instead
  // of being described as if they were going to be written.
  const known = info !== null;
  if (settings.exportVideo && (!known || info.video.length > 0)) {
    const source = info?.video[0];
    const { video } = settings;
    const size =
      video.width && video.height
        ? `${video.width}x${video.height}`
        : video.width
          ? `宽 ${video.width}`
          : video.height
            ? `高 ${video.height}`
            : source?.width && source.height
              ? `${source.width}x${source.height}`
              : "匹配源尺寸";
    lines.push(
      video.codec === "copy"
        ? "视频：流复制"
        : [
            videoEncoderLabel(video.codec),
            size,
            formatFrameRate(video.frameRate) || formatFrameRate(source?.frameRate) || "匹配源帧率",
            rateSummary(settings),
          ]
            .filter(Boolean)
            .join("，"),
    );
  }
  if (settings.exportAudio && (!known || info.audio.length > 0)) {
    const { audio } = settings;
    lines.push(
      audio.codec === "copy"
        ? "音频：流复制"
        : [
            audioEncoderLabel(audio.codec),
            audio.bitrateKbps ? `${audio.bitrateKbps} kbps` : "",
            audio.sampleRate ? `${audio.sampleRate} Hz` : "",
            channelLabel(audio.channels),
          ]
            .filter(Boolean)
            .join("，"),
    );
  }
  const hasSubtitleSource =
    !known || info.subtitles.length > 0 || Boolean(settings.subtitles.externalPath.trim());
  if (settings.exportSubtitles && hasSubtitleSource) {
    const labels = {
      copy: "字幕：复制到文件",
      convert: "字幕：转换并封装",
      burn: "字幕：录制到视频",
      sidecar: `字幕：导出为独立 .${settings.subtitles.sidecarExtension} 文件`,
    } as const;
    lines.push(labels[settings.subtitles.mode]);
  }
  return lines;
}

/** Rough output size in bytes from the configured bitrates; null when unknown. */
export function estimatedOutputBytes(
  settings: TranscodeSettings,
  info: TranscodeSourceInfo | null,
) {
  if (!info || info.durationUs <= 0) return null;
  const start = settings.rangeStartUs ?? 0;
  const end =
    settings.rangeEndUs && settings.rangeEndUs > start ? settings.rangeEndUs : info.durationUs;
  const seconds = Math.max(0, end - start) / 1_000_000;
  let kbps = 0;
  if (settings.exportVideo) {
    const { video } = settings;
    if (video.codec === "copy" || video.rateControl === "quality" || video.rateControl === "auto")
      return null;
    kbps += video.bitrateKbps;
  }
  if (settings.exportAudio) {
    if (settings.audio.codec === "copy" || !settings.audio.bitrateKbps) return null;
    kbps += settings.audio.bitrateKbps;
  }
  return kbps > 0 ? Math.round((kbps * 1000 * seconds) / 8) : null;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function formatLabel(settings: TranscodeSettings) {
  return containerLabel(settings.container);
}
