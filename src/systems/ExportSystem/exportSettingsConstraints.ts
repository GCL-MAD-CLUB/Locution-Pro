import {
  audioFormatOfCodec,
  exportAudioBitrateOptions,
  exportAudioChannelOptions,
  exportAudioSampleRateOptions,
  isAudioOnlyContainer,
  type ExportSettings,
  type ExportSource,
} from "../../core/editor/export/exportTypes";
import { exportRenameRuleOptions } from "./exportRename";

export interface ExportSettingsConstraintContext {
  source: ExportSource | null;
  selectedClipIds: ReadonlySet<string>;
  previewClipId: string | null;
}

function nearestValue(values: number[], target: number) {
  return values.reduce(
    (best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best),
    values[0],
  );
}

function sourceHasAudio(source: ExportSource, selectedClipIds: ReadonlySet<string>) {
  const selected = source.clips.filter((clip) => selectedClipIds.has(clip.id));
  return (selected.length > 0 ? selected : source.clips).some((clip) => clip.hasAudio);
}

function previewChannels(source: ExportSource | null, previewClipId: string | null) {
  if (!source) return null;
  const clip = source.clips.find((item) => item.id === previewClipId) ?? source.clips[0] ?? null;
  return clip?.sourceMedia?.audioChannels ?? null;
}

/**
 * Snaps export settings onto the options the current source, selection, and
 * preview clip actually offer. Returns the same object when nothing changes.
 * This is the fixed point of the settings panel's former adjustment effects.
 */
export function constrainExportSettings(
  settings: ExportSettings,
  context: ExportSettingsConstraintContext,
): ExportSettings {
  let next = settings;
  const replace = (patch: Partial<ExportSettings>) => {
    next = { ...next, ...patch };
  };

  const kind = context.source?.kind ?? "media-bin";
  if (!exportRenameRuleOptions(next.mode, kind).some(([value]) => value === next.renameRule)) {
    replace({ renameRule: "filename" });
  }

  if (context.source && !sourceHasAudio(context.source, context.selectedClipIds)) {
    const patch: Partial<ExportSettings> = {};
    if (next.includeAudio) patch.includeAudio = false;
    if (!next.includeVideo) patch.includeVideo = true;
    if (isAudioOnlyContainer(next.container)) {
      patch.container = "mp4_h264";
      patch.audioCodec = "aac";
    }
    if (Object.keys(patch).length > 0) replace(patch);
  }

  const audioFormat = audioFormatOfCodec(next.audioCodec);
  const channelOptions = exportAudioChannelOptions(
    previewChannels(context.source, context.previewClipId),
  ).filter(([value]) => audioFormat !== "mpeg" || value !== "5.1");
  if (!channelOptions.some(([value]) => value === next.audioChannels)) {
    replace({ audioChannels: "stereo" });
  }

  const bitrateValues = exportAudioBitrateOptions(audioFormat, next.audioCodec).map(([value]) =>
    Number(value),
  );
  if (bitrateValues.length > 0 && !bitrateValues.includes(next.audioBitrateKbps)) {
    replace({ audioBitrateKbps: nearestValue(bitrateValues, next.audioBitrateKbps) });
  }

  const sampleRateValues = exportAudioSampleRateOptions(audioFormat)
    .filter(([value]) => value !== "source")
    .map(([value]) => Number(value));
  if (
    next.audioSampleRateHz !== null &&
    sampleRateValues.length > 0 &&
    !sampleRateValues.includes(next.audioSampleRateHz)
  ) {
    replace({
      audioSampleRateHz: nearestValue(sampleRateValues, next.audioSampleRateHz),
    });
  }

  return next;
}
