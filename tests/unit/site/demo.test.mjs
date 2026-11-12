import assert from "node:assert/strict";
import test from "node:test";
import { demoFrame } from "../../../site/src/demo.js";

test("automatic demo follows import, search, annotation and output without state leaking between scenes", () => {
  assert.equal(demoFrame(3000).scene, "import");
  assert.equal(demoFrame(3000).selected, 2);
  const result = demoFrame(7900);
  assert.equal(result.scene, "edit");
  assert.equal(result.search, "分镜 156");
  assert.equal(result.result, true);
  assert.equal(result.selected, 0);
  assert.equal(demoFrame(11000).keyword, true);
  const output = demoFrame(16500);
  assert.equal(output.scene, "export");
  assert.equal(output.format, true);
  assert.equal(output.menu, false);
  assert.equal(output.search, null);
  assert.equal(output.keyword, false);
});

test("each loop restores the original scene, overlays and cursor", () => {
  assert.deepEqual(demoFrame(21000), demoFrame(0));
  assert.deepEqual(demoFrame(42000 + 7900), demoFrame(7900));
  assert.equal(demoFrame(20500).pointer, null);
  assert.deepEqual(demoFrame(20500).view, [0, 0, 3120, 1940]);
});

test("camera and pointer stay on the original software canvas throughout the choreography", () => {
  for (let time = 0; time <= 21000; time += 50) {
    const { view, pointer, clickProgress } = demoFrame(time);
    const [x, y, width, height] = view;
    assert(x >= 0 && y >= 0 && width > 0 && height > 0);
    assert(x + width <= 3120.01 && y + height <= 1940.01);
    assert(clickProgress >= 0 && clickProgress <= 1);
    if (pointer)
      assert(pointer[0] >= 0 && pointer[0] <= 3120 && pointer[1] >= 0 && pointer[1] <= 1940);
  }
});
