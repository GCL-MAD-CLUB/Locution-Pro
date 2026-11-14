import { Captions, Film } from "lucide-react";
import { createPortal } from "react-dom";
import { MediaBinFolderIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import type { AssetLibraryDragPreview as DragPreview } from "../assetLibraryDragDrop";
// The preview reuses the storyboard shot drag classes, defined with the storyboard panel.
import "../../StoryboardPanel/StoryboardPanel.css";

// The storyboard's shot drag preview geometry: a 40px card with a 3px frame, stacked layers
// 1.5px apart. It shows only while the pointer is over a place the items can drop.
const maximumSize = 40;
const borderSize = 3;
const layerOffset = 1.5;

function PlaceholderIcon({ preview }: { preview: DragPreview }) {
  const { node } = preview;
  if (node.kind === "folder") return <MediaBinFolderIcon />;
  return node.entry.root === "subtitles" ? (
    <Captions aria-hidden="true" />
  ) : (
    <Film aria-hidden="true" />
  );
}

export function AssetLibraryDragPreview({ preview }: { preview: DragPreview | null }) {
  if (!preview) return null;
  const { x, y, thumbnailSrc, aspectRatio, layerCount } = preview;
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
            (thumbnailSrc ? (
              <img src={thumbnailSrc} alt="" draggable={false} />
            ) : (
              <PlaceholderIcon preview={preview} />
            ))}
        </span>
      ))}
    </div>,
    document.body,
  );
}
