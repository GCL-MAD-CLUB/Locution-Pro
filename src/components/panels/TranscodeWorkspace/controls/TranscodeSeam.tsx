import { useRef } from "react";
import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

const keyboardStep = 0.02;

interface TranscodeSeamProps {
  /** "columns" splits left and right and drags sideways; "rows" splits top and bottom. */
  axis: "columns" | "rows";
  /** The element whose width (columns) or height (rows) the ratio is measured against. */
  containerRef: RefObject<HTMLElement | null>;
  /** Share of the container given to the left or top area. */
  ratio: number;
  min: number;
  max: number;
  label: string;
  onChange: (ratio: number) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** A draggable divider between two areas, like the export workspace's zone seams. */
export function TranscodeSeam({
  axis,
  containerRef,
  ratio,
  min,
  max,
  label,
  onChange,
}: TranscodeSeamProps) {
  const lifetime = new RenderLifetime();
  const release = useRef<(() => void) | null>(null);
  lifetime.useAfterCommit(() => () => release.current?.(), []);
  const horizontal = axis === "columns";

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (event.button !== 0 || !container) return;
    event.preventDefault();
    release.current?.();
    const rect = container.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;
    if (size <= 0) return;
    const startPointer = horizontal ? event.clientX : event.clientY;
    const startRatio = ratio;
    const seam = event.currentTarget;
    const pointerId = event.pointerId;
    // Capture keeps the drag alive when the pointer leaves the dialog.
    seam.setPointerCapture(pointerId);
    document.body.classList.add(horizontal ? "is-resizing-x" : "is-resizing-y");
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
      onChange(clamp(startRatio + (pointer - startPointer) / size, min, max));
    };
    const onUp = () => {
      release.current = null;
      if (seam.hasPointerCapture(pointerId)) seam.releasePointerCapture(pointerId);
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      seam.removeEventListener("pointermove", onMove);
      seam.removeEventListener("pointerup", onUp);
      seam.removeEventListener("pointercancel", onUp);
    };
    release.current = onUp;
    seam.addEventListener("pointermove", onMove);
    seam.addEventListener("pointerup", onUp);
    seam.addEventListener("pointercancel", onUp);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const back = horizontal ? "ArrowLeft" : "ArrowUp";
    const forward = horizontal ? "ArrowRight" : "ArrowDown";
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    const step = event.key === forward ? keyboardStep : -keyboardStep;
    onChange(clamp(ratio + step, min, max));
  }

  return lifetime.render(
    <div
      className={`transcode-seam is-${axis}`}
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={beginDrag}
      onKeyDown={handleKeyDown}
    />,
  );
}
