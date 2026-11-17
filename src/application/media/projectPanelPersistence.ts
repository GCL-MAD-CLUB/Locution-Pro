import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { captureOperationError } from "../../errors";
import { isTauriRuntime } from "../../platform/tauri/runtime";
import { usePanelInstanceId } from "../../runtime/systems/PanelState";
import {
  persistProjectPanelState,
  projectStatesLoaded,
  readProjectPanelState,
  subscribeProjectStatesLoaded,
  useProjectPort,
} from "../../systems/ProjectSystem";

/**
 * One writer per panel, with hydration before saving and a final flush on project switch.
 * `sharedId` replaces the panel id for state that every instance of a panel shares.
 */
export function usePersistedProjectPanelState<State>(
  snapshot: State | null,
  onRestore: (saved: State | null, projectId: string) => void,
  enabled = true,
  sharedId?: string,
) {
  const { projectId } = useProjectPort(["projectId"], []);
  const instanceId = usePanelInstanceId();
  const panelId = sharedId ?? instanceId;
  const native = isTauriRuntime();
  const statesLoaded = useSyncExternalStore(
    subscribeProjectStatesLoaded,
    projectStatesLoaded,
    projectStatesLoaded,
  );
  const loaded = !native || statesLoaded;
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const key = enabled && projectId ? JSON.stringify([projectId, panelId]) : null;
  const signature = JSON.stringify(snapshot);
  const pendingRef = useRef<{ projectId: string; panelId: string; snapshot: State } | null>(null);
  const timerRef = useRef<number | null>(null);

  function flush() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) {
      void persistProjectPanelState(pending.projectId, pending.panelId, pending.snapshot).catch(
        (error) => captureOperationError("project.panelState.save", error),
      );
    }
  }

  useLayoutEffect(() => {
    if (!key) {
      if (restoredKey !== null) setRestoredKey(null);
      return;
    }
    if (!loaded || !key || !projectId || restoredKey === key) return;
    restoreRef.current(readProjectPanelState<State>(projectId, panelId), projectId);
    setRestoredKey(key);
  }, [loaded, key, projectId, panelId, restoredKey]);

  useEffect(() => () => flush(), [key]);

  useEffect(() => {
    if (!native || !loaded || !key || !projectId || restoredKey !== key || snapshot === null)
      return;
    pendingRef.current = { projectId, panelId, snapshot };
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, 250);
  }, [native, loaded, key, projectId, panelId, restoredKey, signature]);

  return enabled && loaded && Boolean(key) && restoredKey === key;
}
