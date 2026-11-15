import { Captions, Film } from "lucide-react";
import { OfflineFileIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import type { AssetLibraryNode } from "../assetLibraryNodes";
import { assetLibraryFolderIcons, assetLibraryRootIcons } from "./AssetLibraryTreeIcons";

/** The media bin's kind glyphs, drawn in one fixed-size box so every row lines up. */
export function AssetLibraryKindIcon({ node }: { node: AssetLibraryNode }) {
  if (node.kind === "library") {
    const Icon = assetLibraryRootIcons[node.root];
    return (
      <span className="media-bin-kind-icon folder">
        <Icon />
      </span>
    );
  }
  if (node.kind === "folder") {
    const Icon = assetLibraryFolderIcons[node.folder.root];
    return (
      <span className="media-bin-kind-icon folder">
        <Icon />
      </span>
    );
  }
  if (!node.media) {
    return (
      <span className="media-bin-kind-icon">
        <OfflineFileIcon
          className="media-bin-offline-icon"
          role="img"
          aria-hidden={false}
          aria-label="媒体离线"
        />
      </span>
    );
  }
  const subtitle = node.entry.root === "subtitles";
  const Icon = subtitle ? Captions : Film;
  return (
    <span className={`media-bin-kind-icon ${subtitle ? "subtitle" : "video"}`}>
      <Icon aria-hidden="true" />
    </span>
  );
}
