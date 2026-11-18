import assert from "node:assert/strict";
import test from "node:test";
import { createModuleLoader } from "../support/module-loader.ts";

const load = createModuleLoader(import.meta.url);
function editorHooks() {
  let cursor = 0;
  const slots: { keys: readonly unknown[]; value: unknown }[] = [];
  function memo<Value>(create: () => Value, keys: readonly unknown[]) {
    const index = cursor++;
    const previous = slots[index];
    if (
      !previous ||
      keys.length !== previous.keys.length ||
      keys.some((key, i) => !Object.is(key, previous.keys[i]))
    )
      slots[index] = { keys: [...keys], value: create() };
    return slots[index].value as Value;
  }
  const react = {
    useMemo: memo,
    useCallback: <Value>(callback: Value, keys: readonly unknown[]) => memo(() => callback, keys),
    useSyncExternalStore: <Value>(_subscribe: unknown, read: () => Value) => read(),
  };
  const scoped = load<typeof import("../../../src/runtime/state/useScopedState.ts")>(
    "../../../src/runtime/state/useScopedState.ts",
    { react },
  );
  const sorting = load<typeof import("../../../src/runtime/state/useSemanticSortState.ts")>(
    "../../../src/runtime/state/useSemanticSortState.ts",
    { react, "./useScopedState": scoped },
  );
  return {
    ...scoped,
    ...sorting,
    render<Value>(read: () => Value) {
      cursor = 0;
      return read();
    },
  };
}

test("scoped drafts derive defaults until edited and compose functional updates", () => {
  const hooks = editorHooks();
  const read = (fallback: number) => hooks.render(() => hooks.useScopedState("a", fallback));
  assert.equal(read(1)[0], 1);
  assert.equal(read(2)[0], 2);
  const [, update] = read(2);
  update((value) => value + 1);
  update((value) => value + 1);
  assert.equal(read(50)[0], 4);
});

test("context switches discard edits and isolate late asynchronous callbacks", () => {
  const hooks = editorHooks();
  const read = (context: string) => hooks.render(() => hooks.useScopedState(context, "default"));
  const [, editA] = read("a");
  editA("edited a");
  assert.equal(read("a")[0], "edited a");
  const [, editB] = read("b");
  editB("edited b");
  editA("late a");
  assert.equal(read("b")[0], "edited b");
  assert.equal(read("a")[0], "default");
});

test("new semantic results choose similarity while clearing search restores user sorting", () => {
  const hooks = editorHooks();
  const ordinary = { columnId: "time", direction: "ascending" as const };
  const similarity = { columnId: "similarity", direction: "descending" as const };
  const chosen = { columnId: "name", direction: "descending" as const };
  const read = (version: number | null, context = "a") =>
    hooks.render(() =>
      hooks.useSemanticSortState<{
        columnId: string;
        direction: "ascending" | "descending";
      }>(context, version, ordinary, similarity),
    );
  read(null).setSort(chosen);
  assert.deepEqual(read(1).sort, similarity);
  read(1).setSort(ordinary);
  assert.deepEqual(read(1).sort, ordinary);
  assert.deepEqual(read(2).sort, similarity);
  assert.deepEqual(read(null).sort, ordinary);
  assert.deepEqual(read(null, "b").sort, ordinary);
});
