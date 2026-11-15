import type { ReactNode } from "react";
import { createPortal } from "react-dom";
// The preview reuses the storyboard shot drag classes, defined with the storyboard panel.
import "../../panels/StoryboardPanel/StoryboardPanel.css";

// The storyboard's shot drag preview geometry: a 40px card with a 3px frame, stacked layers
// 1.5px apart. It shows only while the pointer is over a place the items can drop.
const maximumSize = 40;
const borderSize = 3;
const layerOffset = 1.5;
/** The storyboard's shot drag preview stacks at most this many cards. */
export const maximumDragStackLayers = 10;

export interface DragStackPreviewProps {
  x: number;
  y: number;
  /** The dragged item's shown frame, or null to draw the placeholder. */
  thumbnailSrc: string | null;
  aspectRatio: number;
  layerCount: number;
  placeholder: ReactNode;
}

/** The storyboard's shot drag card stack, following the pointer. */
export function DragStackPreview({
  x,
  y,
  thumbnailSrc,
  aspectRatio,
  layerCount,
  placeholder,
}: DragStackPreviewProps) {
  const contentSize = maximumSize - borderSize;
  const width = (aspectRatio >= 1 ? contentSize : contentSize * aspectRatio) + borderSize;
  const height = (aspectRatio >= 1 ? contentSize / aspectRatio : contentSize) + borderSize;
  return createPortal(
    <div
      className="storyboard-shot-keyword-drag-preview"
      style={{
        left: x - width / 2,
        top: y - height / 2,
        width: width + (layerCount - 1) * layerOffset,
        height: height + (layerCount - 1) * layerOffset,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: layerCount }, (_, layerIndex) => (
        <span
          key={layerIndex}
          className={`storyboard-shot-keyword-drag-layer ${
            layerIndex === 0
              ? `is-front ${thumbnailSrc ? "has-thumbnail" : "is-placeholder"}`
              : "is-stacked"
          }`}
          style={{
            left: layerIndex * layerOffset,
            top: layerIndex * layerOffset,
            zIndex: layerCount - layerIndex,
            width,
            height,
          }}
        >
          {layerIndex === 0 &&
            (thumbnailSrc ? <img src={thumbnailSrc} alt="" draggable={false} /> : placeholder)}
        </span>
      ))}
    </div>,
    document.body,
  );
}
