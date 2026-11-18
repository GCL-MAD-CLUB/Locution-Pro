import { scheduleAfter } from "../../../../runtime/scheduling";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  presetDropOutputIds,
  transcodeQueueStore,
  type TranscodePreset,
} from "../../../../systems/TranscodeSystem";

/** Pointer travel before a press becomes a drag, as in the media bin and storyboard. */
const dragThresholdPx = 4;
const draggingClass = "is-dragging-transcode-preset";
const allowedClass = "is-transcode-preset-drop-allowed";

export interface TranscodePresetDragState {
  /** The preset following the pointer; null when no drag is in progress. */
  preview: { preset: TranscodePreset; x: number; y: number } | null;
  /** The queue row under the pointer. */
  rowId: string | null;
  /** The outputs a drop on that row would change. */
  outputIds: readonly string[];
}

const idle: TranscodePresetDragState = { preview: null, rowId: null, outputIds: [] };

export const transcodePresetDragStore = createStore<TranscodePresetDragState>()(() => idle);

export function useTranscodePresetDrag<Selection>(
  selector: (state: TranscodePresetDragState) => Selection,
) {
  return useStore(transcodePresetDragStore, selector);
}

/** The queue row under a point, when the point is inside the queue. */
function queueRowAt(x: number, y: number) {
  const element = document.elementFromPoint(x, y);
  if (!element?.closest("[data-transcode-queue-drop-target]")) return null;
  return element.closest<HTMLElement>("[data-queue-row-id]")?.dataset.queueRowId ?? null;
}

function dropOutputIds(rowId: string | null) {
  if (!rowId) return [];
  const { sources, selectedIds } = transcodeQueueStore.getState();
  return presetDropOutputIds(sources, selectedIds, rowId);
}

/** Keeps the release that ends a drag from also clicking whatever is under it. */
function suppressNextClick(signal: AbortSignal) {
  if (signal.aborted) return;
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true, signal });
  const task = scheduleAfter(() => {
    window.removeEventListener("click", swallow, { capture: true });
    signal.removeEventListener("abort", cancel);
  }, 0);
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
}

/**
 * Drags a preset onto queue rows with pointer events; HTML drag and drop is
 * left to files from the system. Esc cancels.
 */
export function startTranscodePresetDrag(
  event: ReactPointerEvent<HTMLElement>,
  preset: TranscodePreset,
  signal: AbortSignal,
) {
  if (event.button !== 0 || !event.isPrimary) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  let dragging = false;

  const cleanup = () => {
    signal.removeEventListener("abort", cleanup);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("blur", cleanup);
    document.body.classList.remove(draggingClass, allowedClass);
    transcodePresetDragStore.setState(idle, true);
  };

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const travel = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
    if (!dragging && travel < dragThresholdPx) return;
    if (!dragging) {
      dragging = true;
      document.body.classList.add(draggingClass);
    }
    moveEvent.preventDefault();
    const rowId = queueRowAt(moveEvent.clientX, moveEvent.clientY);
    const current = transcodePresetDragStore.getState();
    const outputIds = rowId === current.rowId ? current.outputIds : dropOutputIds(rowId);
    document.body.classList.toggle(allowedClass, outputIds.length > 0);
    transcodePresetDragStore.setState({
      preview: { preset, x: moveEvent.clientX, y: moveEvent.clientY },
      rowId,
      outputIds,
    });
  };

  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    const outputIds = dragging ? dropOutputIds(queueRowAt(upEvent.clientX, upEvent.clientY)) : [];
    cleanup();
    if (!dragging) return;
    upEvent.preventDefault();
    suppressNextClick(signal);
    if (outputIds.length > 0) transcodeQueueStore.getState().applyPreset(outputIds, preset);
  };

  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId === pointerId) cleanup();
  };

  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (!dragging || keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    cleanup();
    // The release that follows must not click the row under the pointer.
    const onRelease = (releaseEvent: PointerEvent) => {
      if (releaseEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointerup", onRelease);
      suppressNextClick(signal);
    };
    window.addEventListener("pointerup", onRelease, { signal });
  };

  signal.addEventListener("abort", cleanup, { once: true });
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("blur", cleanup);
}
