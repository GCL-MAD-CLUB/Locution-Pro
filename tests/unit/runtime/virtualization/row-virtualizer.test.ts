import assert from "node:assert/strict";
import test from "node:test";
import * as virtualCore from "@tanstack/react-virtual";
import { createModuleLoader } from "../../support/module-loader.ts";

const { RowVirtualizerStore } = createModuleLoader(import.meta.url)<
  typeof import("../../../../src/runtime/state/useRowVirtualizer.ts")
>("../../../../src/runtime/state/useRowVirtualizer.ts", {
  react: {},
  "@tanstack/react-virtual": virtualCore,
});

test("virtual rows publish immutable snapshots and notify only on observable changes", () => {
  const store = new RowVirtualizerStore();
  const dispose = store.mount();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });
  const options = {
    count: 100,
    getScrollElement: () => null,
    estimateSize: () => 20,
    initialRect: { width: 400, height: 100 },
    initialOffset: 0,
  };
  try {
    store.configure(options);
    const first = store.read();
    assert.equal(first.totalSize, 2000);
    assert(first.items.length > 0 && first.items.length < options.count);
    const count = notifications;
    store.configure(options);
    assert.equal(store.read(), first);
    assert.equal(notifications, count);
    store.configure({ ...options, count: 3 });
    const next = store.read();
    assert.equal(next.totalSize, 60);
    assert.notEqual(first, next);
    assert.equal(first.totalSize, 2000);
    assert.equal(next.items.length, 3);
    assert(notifications > count);
    unsubscribe();
    const afterUnsubscribe = notifications;
    store.configure({ ...options, count: 1 });
    assert.equal(notifications, afterUnsubscribe);
  } finally {
    unsubscribe();
    dispose();
  }
});
