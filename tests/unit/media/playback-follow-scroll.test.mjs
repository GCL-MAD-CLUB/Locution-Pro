import assert from "node:assert/strict";
import { test } from "node:test";
import {
  animatePlaybackFollowScroll,
  playbackFollowScrollDuration,
} from "../../../src/components/common/utils/playbackFollowScroll.ts";

function animation(initialOffset = 0) {
  let timestamp = 0;
  let handle = 0;
  let position = initialOffset;
  let reads = 0;
  const pending = new Map();
  const positions = [];
  const element = {
    get scrollTop() {
      reads += 1;
      return position;
    },
    set scrollTop(value) {
      position = value;
      positions.push(value);
    },
  };
  const clock = {
    now: () => timestamp,
    requestFrame: (callback) => {
      pending.set(++handle, callback);
      return handle;
    },
    cancelFrame: (id) => pending.delete(id),
  };
  return {
    start: (target, duration) => animatePlaybackFollowScroll(element, target, duration, clock),
    tick(time) {
      timestamp = time;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(timestamp));
    },
    positions,
    get position() {
      return position;
    },
    get reads() {
      return reads;
    },
    get pending() {
      return pending.size;
    },
  };
}

test("follow animation reads geometry once and eases in both directions to the exact target", () => {
  for (const [start, target] of [
    [0, 1000],
    [1000, 0],
  ]) {
    const scroll = animation(start);
    scroll.start(target, 1000);
    for (let time = 0; time <= 1000; time += 100) scroll.tick(time);
    assert.equal(scroll.reads, 1, "no per-frame layout reads");
    assert.equal(scroll.position, target);
    assert.equal(scroll.pending, 0);
    const direction = Math.sign(target - start);
    const steps = scroll.positions
      .slice(1)
      .map((value, i) => (value - scroll.positions[i]) * direction);
    assert.ok(steps.every((value) => value >= 0));
    assert.ok(steps[0] < steps[4], "accelerates");
    assert.ok(steps.at(-1) < steps[5], "decelerates");
  }
});

test("retargeting cancels the old animation and continues from the current position", () => {
  const scroll = animation();
  const cancel = scroll.start(1000, 1000);
  scroll.tick(500);
  assert.equal(scroll.position, 500);
  cancel();
  cancel();
  scroll.tick(600);
  assert.equal(scroll.position, 500);
  assert.equal(scroll.pending, 0);
  scroll.start(100, 400);
  scroll.tick(800);
  assert.equal(scroll.position, 300);
  scroll.tick(1000);
  assert.equal(scroll.position, 100);
  assert.equal(scroll.pending, 0);
});

test("short items and subpixel distances arrive immediately without scheduling frames", () => {
  for (const [target, duration] of [
    [100, 0],
    [100, -1],
    [0.5, 500],
  ]) {
    const scroll = animation();
    const cancel = scroll.start(target, duration);
    assert.equal(scroll.position, target);
    assert.equal(scroll.pending, 0);
    cancel();
  }
});

test("follow duration leaves a paint frame before the target ends", () => {
  assert.equal(playbackFollowScrollDuration(2000, 600, 10, 10, 11, 24), 0);
  const duration = playbackFollowScrollDuration(2000, 600, 10, 10, 20, 60);
  assert.ok(duration > 0 && duration <= (9 / 60) * 1000 - 1000 / 60);
  assert.ok(playbackFollowScrollDuration(100, 600, 0, 48, 72, 24) >= 1000);
});
