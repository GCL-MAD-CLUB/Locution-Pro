import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

function setup() {
  const events = new EventTarget();
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const { suppressReleaseClick } = createModuleLoader(import.meta.url)<
    typeof import("../../../src/components/common/utils/suppressReleaseClick.ts")
  >(
    "../../../src/components/common/utils/suppressReleaseClick.ts",
    {},
    {
      window: {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          listeners.set(type, listener);
          events.addEventListener(type, listener);
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          events.removeEventListener(type, listener);
          if (listeners.get(type) === listener) listeners.delete(type);
        },
      },
    },
  );
  const owner = { current: null as (() => void) | null };
  const click = () => {
    const event = new Event("click", { cancelable: true });
    events.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { events, owner, click, listeners, suppressReleaseClick };
}

test("a drag consumes only its release click and releases every listener", () => {
  const { owner, click, listeners, suppressReleaseClick } = setup();
  suppressReleaseClick(owner);
  assert.equal(click(), true);
  assert.equal(click(), false);
  assert.equal(owner.current, null);
  assert.equal(listeners.size, 0);
});

test("a missing release click never swallows the next pointer or keyboard interaction", () => {
  for (const type of ["pointerdown", "keydown", "blur"]) {
    const { events, owner, click, listeners, suppressReleaseClick } = setup();
    suppressReleaseClick(owner);
    events.dispatchEvent(new Event(type));
    assert.equal(click(), false, type);
    assert.equal(owner.current, null);
    assert.equal(listeners.size, 0);
  }
});

test("replacement and component disposal end pending click suppression", () => {
  const { owner, click, listeners, suppressReleaseClick } = setup();
  suppressReleaseClick(owner);
  const first = owner.current;
  suppressReleaseClick(owner);
  assert.notEqual(owner.current, first);
  owner.current?.();
  assert.equal(owner.current, null);
  assert.equal(click(), false);
  assert.equal(listeners.size, 0);
});
