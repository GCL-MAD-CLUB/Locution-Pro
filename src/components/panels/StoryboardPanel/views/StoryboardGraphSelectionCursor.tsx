import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { StoryboardGraphSelectionMode } from "../../../../core/editor/storyboardGraph/selection";

const markers = {
  replace: "",
  add: "M5 1.5v7M1.5 5h7",
  subtract: "M1.5 5h7",
  intersect: "m2.25 2.25 5.5 5.5m0-5.5-5.5 5.5",
};

// Keep the 9px badge clear of the native arrow while the OS draws the pointer.
const badgeOffset = { x: 12, y: 11 };

export function StoryboardGraphSelectionCursor({
  stageRef,
  mode,
  enabled,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  mode: StoryboardGraphSelectionMode;
  enabled: boolean;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const pointRef = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const marker = markerRef.current;
    if (!stage || !marker) return;
    const paint = () => {
      const point = pointRef.current;
      marker.hidden = true;
      if (!enabled || mode === "replace" || !point || !(point.target instanceof Element)) return;
      if (
        point.target.closest(
          ".storyboard-graph-tools, .storyboard-graph-navigator, .storyboard-graph-preview, .storyboard-graph-message",
        )
      )
        return;
      const bounds = stage.getBoundingClientRect();
      if (
        point.x < bounds.left ||
        point.x >= bounds.right ||
        point.y < bounds.top ||
        point.y >= bounds.bottom
      )
        return;
      // Move only the small badge. The operating system owns the arrow and
      // pointer motion never schedules a graph render.
      marker.style.transform = `translate(${point.x + badgeOffset.x}px, ${point.y + badgeOffset.y}px)`;
      marker.hidden = false;
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      pointRef.current = { x: event.clientX, y: event.clientY, target: event.target };
      paint();
    };
    const hide = () => {
      pointRef.current = null;
      marker.hidden = true;
    };
    paint();
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerenter", move);
    stage.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerenter", move);
      stage.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, [stageRef, mode, enabled]);

  return createPortal(
    <span
      ref={markerRef}
      className="storyboard-graph-selection-cursor"
      data-selection-mode={mode}
      hidden
      aria-hidden="true"
    >
      <svg viewBox="0 0 10 10" fill="none" strokeLinecap="square">
        <path className="storyboard-graph-selection-cursor-outline" d={markers[mode]} />
        <path className="storyboard-graph-selection-cursor-mark" d={markers[mode]} />
      </svg>
    </span>,
    document.body,
  );
}
