import type { PointerEvent as ReactPointerEvent } from "react";
import type { AssetLibraryLocation } from "../../../core/editor/assetLibrary";
import type { AssetLibraryRoot } from "../../../types";
import {
  setExternalAssetLibraryDropTarget,
  trackExternalAssetLibraryDrop,
} from "./assetLibraryDropTarget";

/** Pointer travel before a press becomes a drag, matching the storyboard. */
const dragThresholdPx = 4;

// The storyboard panel's shot drag classes: a no-drop cursor by default, grabbing over a target.
const draggingClass = "is-dragging-storyboard-shot";
const allowedClass = "is-storyboard-shot-drag-allowed";

export interface AssetLibraryItemDragPointer {
  x: number;
  y: number;
}

export interface AssetLibraryItemDragOptions {
  /** The library that takes this kind of item; the other library refuses it. */
  root: AssetLibraryRoot;
  /** Follows the pointer while dragging, then null once the drag ends. */
  onPreview: (pointer: AssetLibraryItemDragPointer | null) => void;
  onDrop: (location: AssetLibraryLocation) => void;
  /** Where the drag keeps the grabbing pointer without dropping, such as its own panel. */
  neutralArea?: HTMLElement | null;
  /** Holds the drag in progress so the panel can end it on unmount. */
  cleanupRef: { current: (() => void) | null };
}

/** Presses in text fields select text instead of starting a drag. */
export const textEntrySelector = "input, textarea, select, [contenteditable='true']";

/** Ends a drag without the release also counting as a click on whatever is under it. */
function suppressNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/**
 * Drags items from a panel into a folder of the asset library panel with pointer events, as
 * the storyboard drags shots onto keywords; HTML drag and drop is reserved for system files.
 * Esc cancels.
 */
export function startAssetLibraryItemDrag(
  event: ReactPointerEvent<HTMLElement>,
  { root, onPreview, onDrop, neutralArea, cleanupRef }: AssetLibraryItemDragOptions,
) {
  if (event.button !== 0 || !event.isPrimary) return;
  if ((event.target as HTMLElement).closest(textEntrySelector)) return;
  cleanupRef.current?.();
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  let dragging = false;

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("blur", cleanup);
    document.body.classList.remove(draggingClass, allowedClass);
    setExternalAssetLibraryDropTarget(null);
    onPreview(null);
    if (cleanupRef.current === cleanup) cleanupRef.current = null;
  };

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (
      !dragging &&
      Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < dragThresholdPx
    ) {
      return;
    }
    if (!dragging) {
      dragging = true;
      document.body.classList.add(draggingClass);
    }
    moveEvent.preventDefault();
    const location = trackExternalAssetLibraryDrop(moveEvent.clientX, moveEvent.clientY, root);
    const overNeutralArea = Boolean(
      neutralArea?.contains(document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)),
    );
    document.body.classList.toggle(allowedClass, Boolean(location) || overNeutralArea);
    onPreview({ x: moveEvent.clientX, y: moveEvent.clientY });
  };

  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    const location = dragging
      ? trackExternalAssetLibraryDrop(upEvent.clientX, upEvent.clientY, root)
      : null;
    cleanup();
    if (!dragging) return;
    upEvent.preventDefault();
    suppressNextClick();
    if (location) onDrop(location);
  };

  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId === pointerId) cleanup();
  };

  // Esc ends the drag while the button is still down; the click that follows the release
  // must not then select the item under the pointer.
  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (!dragging || keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    cleanup();
    const onRelease = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      releaseCleanup();
      suppressNextClick();
    };
    const releaseCleanup = () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", releaseCleanup);
      if (cleanupRef.current === releaseCleanup) cleanupRef.current = null;
    };
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", releaseCleanup);
    cleanupRef.current = releaseCleanup;
  };

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("blur", cleanup);
  cleanupRef.current = cleanup;
}
