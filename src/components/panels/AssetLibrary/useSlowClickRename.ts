import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * How long a click on the selected item waits before renaming, as in a file manager. It
 * matches the system double-click time, so the first click of a double-click never renames.
 */
const renameDelayMs = 500;
/** Pointer travel that turns the press into a drag rather than a click. */
const clickSlopPx = 4;

interface ArmedPress {
  key: string;
  x: number;
  y: number;
}

/**
 * Clicking the only selected item again renames it after a pause. Any further press or key
 * before then, including the second click of a double-click, cancels the rename.
 */
export function useSlowClickRename(startRename: (key: string) => void) {
  const armedRef = useRef<ArmedPress | null>(null);
  const timerRef = useRef<number | null>(null);
  const startRenameRef = useRef(startRename);
  startRenameRef.current = startRename;

  const cancel = useCallback(() => {
    armedRef.current = null;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  /** Arms the rename when the press lands on an item that was already the sole selection. */
  const armOnPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, key: string, soleSelected: boolean) => {
      cancel();
      const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
      if (event.button !== 0 || modified || !soleSelected) return;
      armedRef.current = { key, x: event.clientX, y: event.clientY };
    },
    [cancel],
  );

  /** Starts the pause on a single click that ends where the armed press began. */
  const scheduleOnClick = useCallback((event: ReactMouseEvent<HTMLElement>, key: string) => {
    const armed = armedRef.current;
    armedRef.current = null;
    if (!armed || armed.key !== key || event.detail > 1) return;
    if (Math.hypot(event.clientX - armed.x, event.clientY - armed.y) >= clickSlopPx) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      startRenameRef.current(key);
    }, renameDelayMs);
  }, []);

  return { armOnPointerDown, scheduleOnClick, cancel };
}
