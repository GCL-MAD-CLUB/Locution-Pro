import type { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { usePersistedProjectPanelState } from "../../../../application/media/projectPanelPersistence";
import {
  assetLibraryPinnedPlaces,
  assetLibraryPinnedRootId,
  emptyAssetLibraryHome,
  normalizedAssetLibraryHome,
  withAssetLibraryFavorites,
  withAssetLibraryPins,
  withAssetLibraryUse,
  withoutAssetLibraryRecent,
  type AssetLibraryHome,
  type AssetLibraryPinnedPlace,
} from "../../../../core/editor/assetLibraryHome";
import { useProjectPort } from "../../../../systems/ProjectSystem";
import type { AssetLibraryLocation, AssetLibraryPlace } from "../../../../core/editor/assetLibrary";
import type { ProjectAssetLibraryState } from "../../../../types";
import { assetNodeParent, type AssetLibraryNode } from "../model/nodes";

interface AssetLibraryHomeState {
  /** The project the home belongs to; null for a project that has not been saved yet. */
  projectId: string | null;
  home: AssetLibraryHome;
}

// Shared by every asset-library panel instance, as quick access is in a file manager.
const homeStore = createStore<AssetLibraryHomeState>()(() => ({
  projectId: null,
  home: emptyAssetLibraryHome(),
}));

/** Every instance persists the same snapshot under one id, beside the project. */
const persistenceId = "asset-library:home";

export function updateAssetLibraryHome(recipe: (home: AssetLibraryHome) => AssetLibraryHome) {
  homeStore.setState((state) => {
    const home = recipe(state.home);
    return home === state.home ? state : { home };
  });
}

function restoredHome(
  current: AssetLibraryHomeState,
  saved: AssetLibraryHome | null,
  projectId: string,
): AssetLibraryHomeState {
  // Another instance already restored this project, possibly before its first save landed.
  if (current.projectId === projectId) return current;
  if (saved) return { projectId, home: normalizedAssetLibraryHome(saved) };
  // A project saved for the first time keeps what it gathered while unsaved.
  return { projectId, home: current.projectId === null ? current.home : emptyAssetLibraryHome() };
}

/** The current project's home, restored when a project opens and saved as it changes. */
export function useAssetLibraryHome(lifetime: RenderLifetime) {
  const { projectId } = useProjectPort(["projectId"], []);
  const state = useStore(homeStore);
  lifetime.afterCommit(() => {
    // A new, unsaved project starts with an empty home.
    if (projectId === null && homeStore.getState().projectId !== null) {
      homeStore.setState({ projectId: null, home: emptyAssetLibraryHome() });
    }
  }, [projectId]);
  usePersistedProjectPanelState<AssetLibraryHome>(
    lifetime,
    state.projectId === projectId ? state.home : null,
    (saved, restoredProjectId) =>
      homeStore.setState((current) => restoredHome(current, saved, restoredProjectId)),
    true,
    persistenceId,
  );
  return state.home;
}

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
