import assert from "node:assert/strict";
import test from "node:test";
import {
  createLatestPreview,
  previewTimeUs,
} from "../../../src/application/mediaPreviews/latestPreview.ts";
import { deferred, flush } from "../support/module-loader.ts";

test("pointer movement coalesces pending frames and never publishes an obsolete request", async () => {
  const first = deferred<string>(),
    last = deferred<string>();
  const calls: number[] = [],
    values: string[] = [];
  const request = createLatestPreview(
    (time: number) => {
      calls.push(time);
      return time === 1 ? first.promise : last.promise;
    },
    (value) => values.push(value),
    (error) => assert.fail(String(error)),
  );
  request.request(1);
  request.request(2);
  request.request(3);
  assert.deepEqual(calls, [1]);
  first.resolve("old");
  await flush();
  assert.deepEqual(calls, [1, 3]);
  assert.deepEqual(values, []);
  last.resolve("latest");
  await flush();
  assert.deepEqual(values, ["latest"]);
  await flush();
  assert.deepEqual(calls, [1, 3]);
  request.dispose();
});

test("leaving a preview drops pending work and ignores its in-flight result", async () => {
  const result = deferred<string>();
  const calls: number[] = [],
    values: string[] = [];
  const request = createLatestPreview(
    (time: number) => {
      calls.push(time);
      return result.promise;
    },
    (value) => values.push(value),
    (error) => assert.fail(String(error)),
  );
  request.request(1);
  request.request(2);
  request.dispose();
  result.resolve("late");
  await flush();
  request.request(3);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(values, []);
});

test("a rejected obsolete request does not block the latest frame or report a stale error", async () => {
  const result = deferred<string>();
  const values: string[] = [],
    errors: unknown[] = [];
  const request = createLatestPreview(
    (time: number) => (time === 1 ? result.promise : Promise.resolve("new")),
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  request.request(1);
  request.request(2);
  result.reject(new Error("obsolete"));
  await flush();
  assert.deepEqual(errors, []);
  assert.deepEqual(values, ["new"]);
  request.dispose();
});

test("a failed current request reports once and the next pointer move can recover", async () => {
  const values: string[] = [],
    errors: unknown[] = [];
  const failure = new Error("decoder failed");
  const request = createLatestPreview(
    (time: number) => (time === 1 ? Promise.reject(failure) : Promise.resolve("recovered")),
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  request.request(1);
  await flush();
  request.request(2);
  await flush();
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(values, ["recovered"]);
  request.dispose();
});

test("preview positions are quantized, clamped and bounded before the end of short media", () => {
  assert.equal(previewTimeUs(1_000_000, null, 100_000), null);
  assert.equal(previewTimeUs(0, 0.5, 100_000), null);
  assert.equal(previewTimeUs(1_000_000, NaN, 100_000), null);
  assert.equal(previewTimeUs(1_000_000, -1, 100_000), 0);
  assert.equal(previewTimeUs(1_000_000, 0.51, 100_000), 500_000);
  assert.equal(previewTimeUs(1_000_000, 2, 100_000), 900_000);
  assert.equal(previewTimeUs(20_000, 1, 40_000), 0);
});
