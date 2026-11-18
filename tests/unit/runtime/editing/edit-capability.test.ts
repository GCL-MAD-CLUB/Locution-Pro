import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../../support/module-loader.ts";
import { RenderLifetime } from "../../support/lifetime.ts";
import type { EditCapabilityProjection } from "../../../../src/runtime/state/contracts.ts";

test("fresh event handlers do not republish unchanged capabilities and dispatch uses the latest handler", async () => {
  let cursor = 0;
  const slots: { keys: readonly unknown[]; value: unknown }[] = [];
  let projection: EditCapabilityProjection | undefined;
  const listeners = new Map<string, () => Promise<string>>();
  const capability = createModuleLoader(import.meta.url)<
    typeof import("../../../../src/runtime/capabilities/EditCapability.ts")
  >("../../../../src/runtime/capabilities/EditCapability.ts", {
    react: {
      useMemo<Value>(create: () => Value, keys: readonly unknown[]) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || keys.some((key, i) => !Object.is(key, previous.keys[i])))
          slots[index] = { keys: [...keys], value: create() };
        return slots[index].value as Value;
      },
    },
    "../events/react": {
      useBroadcastEvent(
        _lifetime: unknown,
        _identity: unknown,
        name: string,
        listener: () => Promise<string>,
      ) {
        listeners.set(name, listener);
      },
    },
    "../state/contracts": { EDIT_CAPABILITY_PROJECTION: "edit" },
    "../state/react": {
      usePublishProjection(
        _lifetime: unknown,
        _key: unknown,
        _identity: unknown,
        value: EditCapabilityProjection,
      ) {
        projection = value;
      },
    },
  });
  const invoked: string[] = [];
  const identity = { system: "test", instanceId: "panel" };
  const render = (handler: string, selectedCount = 1) => {
    cursor = 0;
    capability.useEditCapability(new RenderLifetime(), {
      identity,
      active: true,
      selectedCount,
      visibleCount: 2,
      handlers: {
        copy: () => {
          invoked.push(handler);
        },
      },
    });
    return projection;
  };
  const first = render("first");
  assert.equal(
    render("second"),
    first,
    "handler identity must not trigger a projection feedback loop",
  );
  assert.equal(await listeners.get("edit.copy.requested")?.(), "handled");
  assert.deepEqual(invoked, ["second"]);
  assert.notEqual(render("empty", 0), first);
  assert.equal(await listeners.get("edit.copy.requested")?.(), "ignored");
  assert.deepEqual(invoked, ["second"]);
});
