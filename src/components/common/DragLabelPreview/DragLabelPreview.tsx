import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import "./DragLabelPreview.css";

export interface DragLabelPreviewProps {
  x: number;
  y: number;
  icon: ReactNode;
  label: string;
  /** How many items the drag carries or affects; a badge shows it when above one. */
  count?: number;
  /** Dims the label while the pointer is over a place that does not take the drag. */
  refused?: boolean;
}

/** The name and icon of what is being dragged, following the pointer like the dock's tab drag. */
export function DragLabelPreview({
  x,
  y,
  icon,
  label,
  count = 1,
  refused = false,
}: DragLabelPreviewProps) {
  return createPortal(
    <div
      className={`drag-label-preview ${refused ? "is-refused" : ""}`}
      style={{ transform: `translate(${x + 12}px, ${y + 10}px)` }}
      aria-hidden="true"
    >
      <span className="drag-label-preview-icon">{icon}</span>
      <span className="drag-label-preview-text">{label}</span>
      {count > 1 && <span className="drag-label-preview-count">{count}</span>}
    </div>,
    document.body,
  );
}
