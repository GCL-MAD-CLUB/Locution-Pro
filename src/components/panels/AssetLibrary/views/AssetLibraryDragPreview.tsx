import { Captions, Film } from "lucide-react";
import { DragStackPreview } from "../../../common/DragStackPreview";
import type { AssetLibraryDragPreview as DragPreview } from "../assetLibraryDragDrop";
import { assetLibraryFolderIcons, assetLibraryRootIcons } from "./AssetLibraryTreeIcons";

function PlaceholderIcon({ preview }: { preview: DragPreview }) {
  const { node } = preview;
  if (node.kind === "library") {
    const Icon = assetLibraryRootIcons[node.root];
    return <Icon />;
  }
  if (node.kind === "folder") {
    const Icon = assetLibraryFolderIcons[node.folder.root];
    return <Icon />;
  }
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
