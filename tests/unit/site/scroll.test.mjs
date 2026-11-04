import assert from "node:assert/strict";
import test from "node:test";
import {
  findActiveSection,
  findScrollTarget,
  sectionSnapPoints,
} from "../../../site/src/scroll.js";

const layout = { viewportHeight: 900, headerHeight: 73 };
const screens = [
  { id: "intro", top: 73, height: 827 },
  { id: "workspace", top: 900, height: 827 },
  { id: "features", top: 1727, height: 827 },
];
const tallScreens = [
  screens[0],
  { id: "long", top: 900, height: 2000 },
  { id: "search", top: 2900, height: 827 },
];

test("wheel input immediately targets the adjacent screen in either direction", () => {
  assert.equal(findScrollTarget(screens, { ...layout, position: 0, delta: 90 }), 827);
  assert.equal(findScrollTarget(screens, { ...layout, position: 827, delta: 1 }), 1654);
  assert.equal(findScrollTarget(screens, { ...layout, position: 827, delta: -1 }), 0);
  assert.equal(findScrollTarget(screens, { ...layout, position: 1654, delta: -90 }), 827);
});

test("unaligned and reversed gestures choose the next boundary in their direction", () => {
  assert.equal(findScrollTarget(screens, { ...layout, position: 600, delta: 90 }), 827);
  assert.equal(findScrollTarget(screens, { ...layout, position: 950, delta: -90 }), 827);
  assert.equal(findScrollTarget(screens, { ...layout, position: 400, delta: -90 }), 0);
});

test("long content scrolls natively and crossing its edges stops precisely at the boundary", () => {
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 827, delta: 90 }), null);
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 1600, delta: 90 }), null);
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 1950, delta: 90 }), 2000);
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 2000, delta: -90 }), null);
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 850, delta: -90 }), 827);
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 2000, delta: 90 }), 2827);
  assert.equal(findScrollTarget(tallScreens, { ...layout, position: 2827, delta: -90 }), 2000);
});

test("the footer scrolls freely and upward gestures only align when crossing into the last screen", () => {
  for (const position of [1654, 1754, 2400, 2500])
    assert.equal(findScrollTarget(screens, { ...layout, position, delta: 90 }), null);
  assert.equal(findScrollTarget(screens, { ...layout, position: 2400, delta: -90 }), null);
  assert.equal(findScrollTarget(screens, { ...layout, position: 1754, delta: -90 }), null);
  assert.equal(findScrollTarget(screens, { ...layout, position: 1704, delta: -90 }), 1654);
});

test("targets use measured fractional sizes and clamp to the document scroll range", () => {
  const sections = [
    { id: "first", top: 72.625, height: 827.375 },
    { id: "last", top: 900, height: 827.375 },
  ];
  const points = sectionSnapPoints(sections, 900, 72.625, 810);
  assert.deepEqual(
    points.map((point) => point.top),
    [0, 810],
  );
  assert.equal(
    findScrollTarget(sections, {
      ...layout,
      headerHeight: 72.625,
      position: 500,
      maxScroll: 810,
      delta: 90,
    }),
    810,
  );
  assert.equal(sectionSnapPoints(sections, 72, 73).length, 0);
});

test("empty input, page limits and unusable viewports do not create targets", () => {
  assert.equal(findScrollTarget(screens, { ...layout, position: 0, delta: -90 }), null);
  assert.equal(findScrollTarget(screens, { ...layout, position: 800, delta: 0 }), null);
  assert.equal(
    findScrollTarget(screens, { ...layout, position: 800, delta: 90, viewportHeight: 73 }),
    null,
  );
  assert.equal(findScrollTarget([], { ...layout, position: 800, delta: 90 }), null);
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
