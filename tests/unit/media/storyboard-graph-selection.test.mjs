import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStoryboardGraphSelection,
  storyboardGraphMarqueeHitIds,
  storyboardGraphSelectionRect,
  storyboardGraphSelectionRing,
  storyboardGraphSelectionMode,
} from "../../../src/core/editor/storyboardGraph/selection.ts";
import { storyboardGraphWorldPoint } from "../../../src/core/editor/storyboardGraph/camera.ts";

test("selection modifiers temporarily override all toolbar modes", () => {
  for (const fallback of ["replace", "add", "subtract", "intersect"]) {
    for (const [shiftKey, altKey, expected] of [
      [false, false, fallback],
      [true, false, "add"],
      [false, true, "subtract"],
      [true, true, "intersect"],
    ]) {
      assert.equal(storyboardGraphSelectionMode({ shiftKey, altKey }, fallback), expected);
    }
  }
  assert.equal(storyboardGraphSelectionMode({ shiftKey: false, altKey: false }), "replace");
});

test("selection ring gap stays one pixel through 8px diameter, then grows continuously with displayed size", () => {
  for (const [radius, zoom, expectedGap] of [
    [4, 0.2, 1],
    [4, 1, 1],
    [8, 0.5, 1],
    [8, 0.75, 1.5],
    [8, 1, 2],
    [16, 1, 4],
  ]) {
    const ring = storyboardGraphSelectionRing(radius, zoom);
    assert.equal(ring.strokeWidth, 1);
    assert.equal(ring.gap, expectedGap);
    assert.ok(Math.abs(ring.radius - ring.strokeWidth / 2 - radius * zoom - expectedGap) < 1e-10);
  }
  const atThreshold = storyboardGraphSelectionRing(8, 0.5);
  const afterThreshold = storyboardGraphSelectionRing(8, 0.500001);
  assert.ok(afterThreshold.gap > atThreshold.gap);
  assert.ok(afterThreshold.gap - atThreshold.gap < 0.00001);
});

test("selection modes replace, add, subtract and intersect without mutating either input", () => {
  const current = new Set(["a", "b"]);
  const hits = new Set(["b", "c"]);
  for (const [mode, expected] of [
    ["replace", ["b", "c"]],
    ["add", ["a", "b", "c"]],
    ["subtract", ["a"]],
    ["intersect", ["b"]],
  ]) {
    const result = applyStoryboardGraphSelection(current, hits, mode);
    assert.deepEqual([...result].sort(), expected);
    assert.notEqual(result, current);
    assert.notEqual(result, hits);
    assert.deepEqual([...current], ["a", "b"]);
    assert.deepEqual([...hits], ["b", "c"]);
  }
});

test("empty hits preserve additive and subtractive selections and clear replacement and intersection", () => {
  for (const mode of ["replace", "add", "subtract", "intersect"]) {
    const result = applyStoryboardGraphSelection(new Set(["a"]), new Set(), mode);
    assert.deepEqual([...result], ["add", "subtract"].includes(mode) ? ["a"] : []);
    const fromEmpty = applyStoryboardGraphSelection(new Set(), new Set(["a"]), mode);
    assert.deepEqual([...fromEmpty], ["replace", "add"].includes(mode) ? ["a"] : []);
  }
});

test("marquee uses the gesture's original selection so shrinking a rectangle restores prior nodes", () => {
  const original = new Set(["a", "b", "c"]);
  assert.deepEqual(
    [...applyStoryboardGraphSelection(original, new Set(["a", "b"]), "subtract")],
    ["c"],
  );
  assert.deepEqual(
    [...applyStoryboardGraphSelection(original, new Set(["a"]), "subtract")],
    ["b", "c"],
  );
  assert.deepEqual(
    [...applyStoryboardGraphSelection(original, new Set(["b", "d"]), "intersect")],
    ["b"],
  );
  assert.deepEqual([...original], ["a", "b", "c"]);
});

test("marquee hit testing is direction-independent at different zooms and includes boundary centers", () => {
  const nodes = [
    { id: "a", x: -10, y: -10, radius: 3, thumbnailFrame: 0 },
    { id: "b", x: 10, y: 10, radius: 3, thumbnailFrame: 0 },
    { id: "c", x: 11, y: 11, radius: 3, thumbnailFrame: 0 },
  ];
  const size = { width: 800, height: 500 };
  for (const zoom of [0.1, 0.5, 1]) {
    const camera = { x: 0, y: 0, zoom };
    const a = { x: 400 - 10 * zoom, y: 250 - 10 * zoom };
    const b = { x: 400 + 10 * zoom, y: 250 + 10 * zoom };
    for (const [start, end] of [
      [a, b],
      [b, a],
    ]) {
      const rect = storyboardGraphSelectionRect(
        storyboardGraphWorldPoint(start, camera, size),
        storyboardGraphWorldPoint(end, camera, size),
      );
      assert.deepEqual([...storyboardGraphMarqueeHitIds(nodes, rect)], ["a", "b"]);
    }
  }
});
