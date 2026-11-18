import assert from "node:assert/strict";
import test from "node:test";
import { VirtualTimeScheduler } from "rxjs";
import { clientError } from "../../../src/errors/model.ts";
import { createModuleLoader } from "../support/module-loader.ts";
import { CommittedLifetime, RenderLifetime } from "../support/lifetime.ts";

type Scheduling = typeof import("../../../src/runtime/scheduling.ts");

function setup() {
  const clock = new VirtualTimeScheduler(undefined, 100);
  const scheduling = createModuleLoader(import.meta.url)<Scheduling>(
    "../../../src/runtime/scheduling.ts",
    { rxjs: { asyncScheduler: clock }, "../errors/model": { clientError } },
  );
  return { clock, ...scheduling };
}

test("delays run once after their deadline and zero delay remains asynchronous", () => {
  const { clock, scheduleAfter } = setup();
  const calls: number[] = [];
  const zero = scheduleAfter(() => calls.push(clock.now()), 0);
  const delayed = scheduleAfter(() => calls.push(clock.now()), 20);
  assert.deepEqual(calls, []);
  assert.equal(zero.pending, true);
  clock.maxFrames = 19;
  clock.flush();
  assert.deepEqual(calls, [0]);
  assert.equal(zero.pending, false);
  clock.maxFrames = 100;
  clock.flush();
  assert.deepEqual(calls, [0, 20]);
  assert.equal(delayed.pending, false);
});

test("replacing or cancelling delayed work releases it without callbacks", () => {
  const { clock, scheduleAfter, cancelTask } = setup();
  const calls: string[] = [];
  const first = scheduleAfter(() => calls.push("stale"), 20);
  cancelTask(first);
  cancelTask(first);
  cancelTask(null);
  cancelTask(undefined);
  scheduleAfter(() => calls.push("latest"), 30);
  clock.flush();
  assert.deepEqual(calls, ["latest"]);
  assert.equal(first.pending, false);
  assert.equal(clock.actions.length, 0);
});

test("recurring work starts after its period and can stop inside a callback", () => {
  const { clock, repeatEvery } = setup();
  const calls: number[] = [];
  const task = repeatEvery(() => {
    calls.push(clock.now());
    if (calls.length === 3) task.cancel();
  }, 10);
  clock.flush();
  assert.deepEqual(calls, [10, 20, 30]);
  assert.equal(task.pending, false);
  assert.equal(clock.actions.length, 0);
  for (const period of [0, -1, Infinity, NaN]) assert.throws(() => repeatEvery(() => {}, period));
});

test("committed component resources cancel on key changes and disposal", () => {
  const { clock, scheduleAfter, repeatEvery } = setup();
  const owner = new CommittedLifetime();
  const calls: string[] = [];
  function render(key: string) {
    const lifetime = new RenderLifetime();
    lifetime.useAfterCommit(() => {
      const task = scheduleAfter(() => calls.push(key), 20);
      const ticks = repeatEvery(() => calls.push("tick"), 10);
      return () => {
        task.cancel();
        ticks.cancel();
      };
    }, [key]);
    return lifetime;
  }
  render("abandoned");
  assert.equal(clock.actions.length, 0);
  owner.commit(render("old"), "afterCommit");
  owner.commit(render("new"), "afterCommit");
  clock.maxFrames = 20;
  clock.flush();
  assert.deepEqual(calls, ["tick", "new", "tick"]);
  owner.dispose();
  clock.maxFrames = 100;
  clock.flush();
  assert.equal(clock.actions.length, 0);
  assert.deepEqual(calls, ["tick", "new", "tick"]);
});

test("async waits release abort listeners on completion and scheduled work on abort", async () => {
  const { clock, waitForDelay } = setup();
  const completed = new AbortController();
  const waiting = waitForDelay(10, completed.signal);
  clock.flush();
  await waiting;
  completed.abort(new Error("too late"));
  const controller = new AbortController();
  const pending = waitForDelay(50, controller.signal);
  const reason = new Error("cancelled");
  const rejection = assert.rejects(pending, (error) => error === reason);
  controller.abort(reason);
  await rejection;
  await assert.rejects(waitForDelay(50, controller.signal), (error) => error === reason);
  assert.equal(clock.actions.length, 0);
});

test("callback failures release recurring work and remain observable", () => {
  const { clock, repeatEvery } = setup();
  const error = new Error("failed tick");
  const task = repeatEvery(() => {
    throw error;
  }, 10);
  assert.throws(
    () => clock.flush(),
    (caught) => caught === error,
  );
  assert.equal(task.pending, false);
  assert.equal(clock.actions.length, 0);
});
