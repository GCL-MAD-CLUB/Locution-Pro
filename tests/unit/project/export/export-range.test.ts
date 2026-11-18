import assert from "node:assert/strict";
import test from "node:test";
import { exportRange } from "../../support/export-range.ts";
import type {
  ExportClip,
  ExportRangeExtension,
} from "../../../../src/core/editor/export/exportTypes.ts";

const {
  defaultExportRangeExtension,
  editExportRangeExtension,
  exportClipDurationUs,
  exportClipPreviewRanges,
  resolveExportClipRange,
} = exportRange;

function assertRangeEqual(actual: unknown, expected: unknown) {
  assert.deepEqual(structuredClone(actual), expected);
}

function clip(frameRate: number | null, durationUs = 4_000_000): ExportClip {
  return {
    startUs: 1_000_000,
    endUs: 2_000_000,
    sourceMedia: { frameRate, durationUs },
  } as ExportClip;
}

test("edits both sides when linked, allows asymmetry, and relinks to the leading value", () => {
  const linked = editExportRangeExtension(defaultExportRangeExtension, { after: 7.6 });
  assertRangeEqual(linked, { unit: "frames", before: 8, after: 8, linked: true });
  const unlinked = editExportRangeExtension(linked, { linked: false });
  const seconds = editExportRangeExtension(unlinked, { unit: "seconds" });
  const asymmetric = editExportRangeExtension(seconds, { before: 0.25, after: 1.5 });
  assertRangeEqual(asymmetric, { unit: "seconds", before: 0.25, after: 1.5, linked: false });
  assertRangeEqual(editExportRangeExtension(asymmetric, { linked: true }), {
    unit: "seconds",
    before: 0.25,
    after: 0.25,
    linked: true,
  });
  assertRangeEqual(editExportRangeExtension(asymmetric, { before: -1, after: NaN }), {
    unit: "seconds",
    before: 0,
    after: 0,
    linked: false,
  });
});

test("frame offsets use each source's frame rate, including fractional and missing rates", () => {
  const extension = { ...defaultExportRangeExtension, before: 6, after: 6 };
  assertRangeEqual(resolveExportClipRange(clip(30), extension), {
    startUs: 800_000,
    endUs: 2_200_000,
  });
  assertRangeEqual(resolveExportClipRange(clip(30_000 / 1_001), extension), {
    startUs: 799_800,
    endUs: 2_200_200,
  });
  assertRangeEqual(resolveExportClipRange(clip(null), extension), {
    startUs: 750_000,
    endUs: 2_250_000,
  });
});

test("second offsets respect source bounds and leave open ends open", () => {
  const sourceClip = clip(30);
  const extension: ExportRangeExtension = { unit: "seconds", before: 2, after: 3, linked: false };
  assertRangeEqual(resolveExportClipRange(sourceClip, extension), { startUs: 0, endUs: 4_000_000 });
  assertRangeEqual(resolveExportClipRange(clip(30, 0), extension), {
    startUs: 0,
    endUs: 5_000_000,
  });
  const openEnded = { ...sourceClip, endUs: 0 };
  assertRangeEqual(resolveExportClipRange(openEnded, extension), { startUs: 0, endUs: 0 });
  assert.equal(exportClipDurationUs(openEnded, extension), 4_000_000);
  assert.equal(exportClipDurationUs(sourceClip, extension), 4_000_000);
  assertRangeEqual(resolveExportClipRange(sourceClip), { startUs: 1_000_000, endUs: 2_000_000 });
});

test("preview keeps original brackets and uses the outer bounds for extensions", () => {
  const sourceClip = clip(25);
  assertRangeEqual(exportClipPreviewRanges(sourceClip, undefined, 25, 0), null);
  const extension: ExportRangeExtension = {
    unit: "seconds",
    before: 0.01,
    after: 5,
    linked: false,
  };
  const ranges = exportClipPreviewRanges(sourceClip, extension, 25, 4_000_000);
  assertRangeEqual(ranges, {
    original: { startFrame: 25, endFrame: 49 },
    playback: { startFrame: 25, endFrame: 99 },
    bounds: { startFrame: 24.75, endFrame: 99 },
  });
  assertRangeEqual(
    exportClipPreviewRanges({ ...sourceClip, startUs: 21_000, endUs: 0 }, extension, 25, 4_000_000)
      ?.original,
    { startFrame: 1, endFrame: 99 },
  );
});
