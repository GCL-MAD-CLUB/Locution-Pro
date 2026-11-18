import { scheduleAfter, cancelTask, type ScheduledTask } from "../../../../runtime/scheduling";
import type { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import {
  useCallback,
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

function isNameTarget(target: EventTarget | null) {
  return Boolean((target as Element | null)?.closest("[data-asset-name]"));
}

/**
 * Clicking the only selected item's name again renames it after a pause. Any further
 * press or key before then, including the second click of a double-click, cancels the rename.
 */
export function useSlowClickRename(lifetime: RenderLifetime, startRename: (key: string) => void) {
  const armedRef = useRef<ArmedPress | null>(null);
  const timerRef = useRef<ScheduledTask | null>(null);
  const startRenameRef = useRef(startRename);
  lifetime.useBeforePaint(() => {
    startRenameRef.current = startRename;
  });

  const cancel = useCallback(() => {
    armedRef.current = null;
    if (timerRef.current !== null) cancelTask(timerRef.current);
    timerRef.current = null;
  }, []);

  lifetime.useAfterCommit(() => cancel, [cancel]);

  /** Arms the rename only on the name text of the sole selected item. */
  const armOnPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, key: string, soleSelected: boolean) => {
      cancel();
      const modified = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
      if (event.button !== 0 || modified || !soleSelected || !isNameTarget(event.target)) return;
      armedRef.current = { key, x: event.clientX, y: event.clientY };
    },
    [cancel],
  );

  /** Starts the pause on a single click that ends where the armed press began. */
  const scheduleOnClick = useCallback((event: ReactMouseEvent<HTMLElement>, key: string) => {
    const armed = armedRef.current;
    armedRef.current = null;
    if (!armed || armed.key !== key || event.detail > 1 || !isNameTarget(event.target)) return;
    if (Math.hypot(event.clientX - armed.x, event.clientY - armed.y) >= clickSlopPx) return;
    timerRef.current = scheduleAfter(() => {
      timerRef.current = null;
      startRenameRef.current(key);
    }, renameDelayMs);
  }, []);

  return { armOnPointerDown, scheduleOnClick, cancel };
}
