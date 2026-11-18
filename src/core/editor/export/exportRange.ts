import { DEFAULT_FRAME_RATE, frameDurationUs, timeUsToFrame } from "../playback/timeline";
import type { ExportClip, ExportRangeExtension } from "./exportTypes";

export const defaultExportRangeExtension: Readonly<ExportRangeExtension> = {
  unit: "frames",
  before: 0,
  after: 0,
  linked: true,
};

export function editExportRangeExtension(
  current: ExportRangeExtension,
  change: Partial<ExportRangeExtension>,
): ExportRangeExtension {
  const next = { ...current, ...change };
  function amount(value: number) {
    const bounded = Number.isFinite(value) ? Math.max(0, value) : 0;
    return next.unit === "frames" ? Math.round(bounded) : bounded;
  }
  const before = amount(next.before);
  const after = amount(next.after);
  const linkedAmount = change.after === undefined ? before : after;
  return {
    ...next,
    before: next.linked ? linkedAmount : before,
    after: next.linked ? linkedAmount : after,
  };
}

export function resolveExportClipRange(
  clip: Pick<ExportClip, "startUs" | "endUs" | "sourceMedia">,
  extension = defaultExportRangeExtension,
  sourceDurationUs = clip.sourceMedia?.durationUs ?? 0,
) {
  const mediaFrameRate = clip.sourceMedia?.frameRate ?? 0;
  const sourceFrameRate =
    Number.isFinite(mediaFrameRate) && mediaFrameRate > 0 ? mediaFrameRate : DEFAULT_FRAME_RATE;
  const unitUs = extension.unit === "frames" ? 1_000_000 / sourceFrameRate : 1_000_000;
  function offsetUs(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const units = extension.unit === "frames" ? Math.round(amount) : amount;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.round(units * unitUs));
  }
  const beforeUs = offsetUs(extension.before);
  const afterUs = offsetUs(extension.after);
  const extendedEndUs = Math.min(Number.MAX_SAFE_INTEGER, clip.endUs + afterUs);
  return {
    startUs: Math.max(0, clip.startUs - beforeUs),
    endUs:
      clip.endUs <= 0 || afterUs === 0
        ? clip.endUs
        : sourceDurationUs > 0
          ? Math.min(sourceDurationUs, extendedEndUs)
          : extendedEndUs,
  };
}

export function exportClipDurationUs(clip: ExportClip, extension?: ExportRangeExtension) {
  const range = resolveExportClipRange(clip, extension);
  const endUs = range.endUs > 0 ? range.endUs : clip.sourceMedia?.durationUs || clip.durationUs;
  return Math.max(0, endUs - range.startUs);
}

function exportClipFrameRange(
  range: Pick<ExportClip, "startUs" | "endUs">,
  frameRate: number,
  durationFrames: number,
) {
  const startFrame = Math.min(durationFrames - 1, timeUsToFrame(range.startUs, frameRate));
  const endFrame =
    range.endUs > 0
      ? Math.ceil(((range.endUs - 0.5) / 1_000_000) * frameRate) - 1
      : durationFrames - 1;
  return { startFrame, endFrame: Math.max(startFrame, Math.min(durationFrames - 1, endFrame)) };
}

export function exportClipPreviewRanges(
  clip: Pick<ExportClip, "startUs" | "endUs" | "sourceMedia">,
  extension: ExportRangeExtension | undefined,
  frameRate: number,
  durationUs: number,
) {
  const durationFrames = timeUsToFrame(durationUs, frameRate);
  if (durationFrames === 0) return null;

  const original = exportClipFrameRange(clip, frameRate, durationFrames);
  const extended = resolveExportClipRange(clip, extension, durationUs);
  const playback = exportClipFrameRange(extended, frameRate, durationFrames);
  const beforeUs = Math.max(0, clip.startUs - extended.startUs);
  const afterUs = Math.max(0, extended.endUs - clip.endUs);
  const frameUs = frameDurationUs(frameRate);
  return {
    original,
    playback,
    bounds: {
      startFrame:
        beforeUs > 0 && extended.startUs === 0
          ? 0
          : Math.max(0, original.startFrame - beforeUs / frameUs),
      endFrame:
        afterUs > 0 && extended.endUs === durationUs
          ? durationFrames - 1
          : Math.min(durationFrames - 1, original.endFrame + afterUs / frameUs),
    },
  };
}
