import type { AssetLibraryLocation, AssetLibraryPlace } from "../../../core/editor/assetLibrary";
import {
  assetLibraryPinnedPlaces,
  assetLibraryPinnedRootId,
  withAssetLibraryFavorites,
  withAssetLibraryPins,
  withAssetLibraryUse,
  withoutAssetLibraryRecent,
  type AssetLibraryHome,
  type AssetLibraryPinnedPlace,
} from "../../../core/editor/assetLibraryHome";
import type { ProjectAssetLibraryState } from "../../../types";
import { updateAssetLibraryHome } from "./assetLibraryHomeState";
import { assetNodeParent, type AssetLibraryNode } from "./assetLibraryNodes";

interface AssetLibraryHomeActionContext {
  library: ProjectAssetLibraryState;
  home: AssetLibraryHome;
  showHidden: boolean;
  view: {
    navigate: (place: AssetLibraryPlace) => void;
    select: (keys: Iterable<string>, focusKey?: string | null, anchorKey?: string | null) => void;
  };
}

/** Quick access, favorites and recent use, as a file manager's home offers them. */
export function assetLibraryHomeActions({
  library,
  home,
  showHidden,
  view,
}: AssetLibraryHomeActionContext) {
  return {
    /** Pinned folders and libraries that still exist, in pinning order, for the navigation pane. */
    pinnedPlaces(): AssetLibraryPinnedPlace[] {
      return assetLibraryPinnedPlaces(home, library.folders).filter(
        (pinned) => showHidden || !pinned.folder?.hidden,
      );
    },

    /** Pin ids of folders and library tops; nothing when the items include materials. */
    pinIds(nodes: readonly AssetLibraryNode[], treeLocation?: AssetLibraryLocation) {
      if (treeLocation) {
        return [treeLocation.folderId ?? assetLibraryPinnedRootId(treeLocation.root)];
      }
      if (nodes.some((node) => node.kind === "entry")) return [];
      return nodes.flatMap((node) =>
        node.kind === "folder"
          ? [node.folder.id]
          : node.kind === "library"
            ? [assetLibraryPinnedRootId(node.root)]
            : [],
      );
    },

    /** Unpins only when every folder is pinned already, as a file manager's menu does. */
    pinState(pinIds: readonly string[]) {
      if (pinIds.length === 0) return null;
      return pinIds.every((id) => home.pinnedFolderIds.includes(id)) ? "unpin" : "pin";
    },

    favoriteState(entryIds: readonly string[]) {
      if (entryIds.length === 0) return null;
      return entryIds.every((id) => home.favoriteEntryIds.includes(id)) ? "remove" : "add";
    },

    setPinned(pinIds: readonly string[], pinned: boolean) {
      updateAssetLibraryHome((current) => withAssetLibraryPins(current, pinIds, pinned));
    },

    setFavorite(entryIds: readonly string[], favorite: boolean) {
      updateAssetLibraryHome((current) => withAssetLibraryFavorites(current, entryIds, favorite));
    },

    recordUse(entryId: string) {
      updateAssetLibraryHome((current) => withAssetLibraryUse(current, entryId, Date.now()));
    },

    removeRecent(entryIds: readonly string[]) {
      updateAssetLibraryHome((current) => withoutAssetLibraryRecent(current, entryIds));
    },

    /** Opens the folder holding an item and selects the item there. */
    openLocation(node: AssetLibraryNode) {
      view.navigate(assetNodeParent(node));
      view.select([node.key], node.key, node.key);
    },
  } as const;
}
