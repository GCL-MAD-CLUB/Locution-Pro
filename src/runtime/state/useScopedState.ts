import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";

function createEditScope<Value>(key: unknown) {
  let snapshot: { value: Value } | null = null;
  const listeners = new Set<() => void>();
  return {
    key,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => snapshot,
    update(action: SetStateAction<Value>, fallback: Value) {
      const previous = snapshot ? snapshot.value : fallback;
      const value =
        typeof action === "function" ? (action as (value: Value) => Value)(previous) : action;
      if (snapshot && Object.is(snapshot.value, value)) return;
      snapshot = { value };
      for (const listener of listeners) listener();
    },
  };
}

/** Defaults are derived until the first edit. Each context owns its own edit store;
 * late callbacks from an old context cannot overwrite the active context's edits.
 * Returning to a previously visited context creates a fresh editing session.
 */
export function useScopedState<Value>(
  key: unknown,
  initial: Value,
): [Value, Dispatch<SetStateAction<Value>>] {
  const scope = useMemo(() => createEditScope<Value>(key), [key]);
  const edit = useSyncExternalStore(scope.subscribe, scope.read, scope.read);
  const update = useCallback<Dispatch<SetStateAction<Value>>>(
    (action) => scope.update(action, initial),
    [scope, initial],
  );
  return [edit ? edit.value : initial, update];
}
