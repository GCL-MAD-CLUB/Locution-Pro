import { createModuleLoader, deferred, flush } from "../support/module-loader.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { WindowCloseAction } from "../../../src/application/windowClose.ts";

const loadModule = createModuleLoader(import.meta.url);

type WindowCloseModule = typeof import("../../../src/application/windowClose.ts");

function windowClose() {
  return loadModule<WindowCloseModule>(
    "../../../src/application/windowClose.ts",
    {
      "../errors/runtime": { normalizeError: (error: unknown) => error },
    },
    { setTimeout, clearTimeout },
  );
}

test("window close always waits, and ignores re-entry and installer shutdown", () => {
  const { windowCloseAction } = windowClose();
  const cases: Array<[WindowCloseAction, Parameters<WindowCloseModule["windowCloseAction"]>[0]]> = [
    ["block-install", { updateInstalling: true, closing: false, projectDirty: false }],
    ["block-install", { updateInstalling: true, closing: true, projectDirty: true }],
    ["ignore-reentry", { updateInstalling: false, closing: true, projectDirty: false }],
    ["ignore-reentry", { updateInstalling: false, closing: true, projectDirty: true }],
    ["confirm-dirty", { updateInstalling: false, closing: false, projectDirty: true }],
    ["close", { updateInstalling: false, closing: false, projectDirty: false }],
  ];
  for (const [action, state] of cases) {
    assert.equal(windowCloseAction(state), action);
  }
});

test("clean quit destroys the window only after export cancellation settles", async () => {
  const { finishWindowClose } = windowClose();
  const gate = deferred<void>();
  const calls: string[] = [];
  const pending = finishWindowClose(
    async () => {
      calls.push("cancel-start");
      await gate.promise;
      calls.push("cancel-done");
    },
    async () => {
      calls.push("destroy");
    },
    5_000,
  );
  await flush();
  assert.deepEqual(calls, ["cancel-start"]);
  gate.resolve();
  await pending;
  assert.deepEqual(calls, ["cancel-start", "cancel-done", "destroy"]);
});

test("a hung export task cannot block quit past the cleanup timeout", async () => {
  const { finishWindowClose } = windowClose();
  const calls: string[] = [];
  await finishWindowClose(
    () => new Promise(() => {}),
    async () => {
      calls.push("destroy");
    },
    20,
  );
  assert.deepEqual(calls, ["destroy"]);
});

test("a failed export cancellation leaves the window open", async () => {
  const { finishWindowClose } = windowClose();
  const calls: string[] = [];
  await assert.rejects(
    finishWindowClose(
      async () => {
        throw new Error("cancel failed");
      },
      async () => {
        calls.push("destroy");
      },
      5_000,
    ),
    /cancel failed/,
  );
  assert.deepEqual(calls, []);
});
