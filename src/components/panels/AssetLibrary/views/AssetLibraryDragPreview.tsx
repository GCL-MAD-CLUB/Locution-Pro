import { Captions, Film } from "lucide-react";
import { DragStackPreview } from "../../../common/DragStackPreview";
import { MediaBinFolderIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import type { AssetLibraryDragPreview as DragPreview } from "../assetLibraryDragDrop";

function PlaceholderIcon({ preview }: { preview: DragPreview }) {
  const { node } = preview;
  if (node.kind !== "entry") return <MediaBinFolderIcon />;
  return node.entry.root === "subtitles" ? (
    <Captions aria-hidden="true" />
  ) : (
    <Film aria-hidden="true" />
  );
}

export function AssetLibraryDragPreview({ preview }: { preview: DragPreview | null }) {
  if (!preview) return null;
  return (
    <DragStackPreview
      x={preview.x}
      y={preview.y}
      thumbnailSrc={preview.thumbnailSrc}
      aspectRatio={preview.aspectRatio}
      layerCount={preview.layerCount}
      placeholder={<PlaceholderIcon preview={preview} />}
    />
  );
}
