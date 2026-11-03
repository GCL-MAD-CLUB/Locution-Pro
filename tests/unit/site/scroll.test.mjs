import assert from "node:assert/strict";
import test from "node:test";
import { findActiveSection, findSnapTarget } from "../../../site/src/scroll.js";

const layout = { viewportHeight: 900, headerHeight: 73 };

test("settling only corrects a small remaining distance in the reading direction", () => {
  assert.equal(findSnapTarget([73, 900, 1727], { ...layout, position: 800, direction: 1 }), 827);
  assert.equal(findSnapTarget([73, 900, 1727], { ...layout, position: 850, direction: -1 }), 827);
});

test("scrolling past a boundary never pulls the reader backward", () => {
  assert.equal(findSnapTarget([73, 900], { ...layout, position: 850, direction: 1 }), null);
  assert.equal(findSnapTarget([73, 900], { ...layout, position: 800, direction: -1 }), null);
});

test("settling never skips intervening content or moves without a direction", () => {
  assert.equal(findSnapTarget([73, 900, 2900], { ...layout, position: 1600, direction: 1 }), null);
  assert.equal(findSnapTarget([73, 900], { ...layout, position: 800, direction: 0 }), null);
  assert.equal(findSnapTarget([73, 900], { ...layout, position: 827, direction: 1 }), null);
});

test("the correction range shrinks with a short viewport and respects the header", () => {
  const short = { viewportHeight: 400, headerHeight: 100, direction: 1 };
  assert.equal(findSnapTarget([500], { ...short, position: 385 }), 400);
  assert.equal(findSnapTarget([500], { ...short, position: 370 }), null);
  assert.equal(findSnapTarget([500], { ...short, position: 385, viewportHeight: 100 }), null);
});

test("the active chapter follows the reading line, including inside long sections", () => {
  const sections = [
    { id: "intro", top: 73 },
    { id: "features", top: 900 },
    { id: "search", top: 2900 },
  ];
  assert.equal(findActiveSection(sections, 0, 73, 900), "intro");
  assert.equal(findActiveSection(sections, 1200, 73, 900), "features");
  assert.equal(findActiveSection(sections, 2700, 73, 900), "search");
  assert.equal(findActiveSection([], 0, 73, 900), "");
});
