import type { CSSProperties } from "react";
import {
  assetLibraryFolderOutline,
  assetLibraryPathText,
  assetLibraryRootLabels,
} from "../../../core/editor/assetLibrary";
import type { AssetLibraryRoot, ProjectAssetLibraryState } from "../../../types";
import { PopupMenuItem } from "../PopupMenu";
import "./AssetLibraryFolderMenu.css";

interface AssetLibraryFolderMenuItemsProps {
  library: ProjectAssetLibraryState;
  root: AssetLibraryRoot;
  onSelect: (folderId: string | null) => void;
}

/**
 * The folders of one library as an indented outline, so "添加到素材库" names where the items
 * go. The library itself comes first for its top level.
 */
export function AssetLibraryFolderMenuItems({
  library,
  root,
  onSelect,
}: AssetLibraryFolderMenuItemsProps) {
  const item = (folderId: string | null, label: string, depth: number) => (
    <PopupMenuItem
      key={folderId ?? ""}
      title={assetLibraryPathText(library, { root, folderId })}
      onSelect={() => onSelect(folderId)}
    >
      <span
        className="asset-library-folder-menu-label"
        style={{ "--asset-library-folder-menu-depth": depth } as CSSProperties}
      >
        {label}
      </span>
    </PopupMenuItem>
  );
  return (
    <>
      {item(null, assetLibraryRootLabels[root], 0)}
      {assetLibraryFolderOutline(library, root).map(({ folder, depth }) =>
        item(folder.id, folder.name, depth),
      )}
    </>
  );
}
