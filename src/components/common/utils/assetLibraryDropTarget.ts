import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { AssetLibraryLocation } from "../../../core/editor/assetLibrary";
import type { AssetLibraryRoot } from "../../../types";

/** A place in the asset library panel that accepts dropped items. */
export interface AssetLibraryDropTarget {
  location: AssetLibraryLocation;
  /** Tells apart the item pane, folder items, tree rows and crumbs that share a folder. */
  key: string;
}

/** Tree rows use their own drop keys, apart from the same folders in the item pane. */
export const assetLibraryTreeDropPrefix = "tree:";

/**
 * Drop targets carry these attributes. The items pane, folder items, tree rows and address
 * crumbs all mark themselves, so one hit test finds whichever is under the pointer, whichever
 * panel the drag started in.
 */
export function assetLibraryDropTargetProps(location: AssetLibraryLocation, key: string) {
  return {
    "data-asset-drop-root": location.root,
    "data-asset-drop-folder": location.folderId ?? "",
    "data-asset-drop-key": key,
  };
}

export function assetLibraryDropTargetAt(
  clientX: number,
  clientY: number,
): AssetLibraryDropTarget | null {
  const element = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-asset-drop-root]");
  if (!element) return null;
  const { assetDropRoot, assetDropFolder, assetDropKey } = element.dataset;
  return {
    location: { root: assetDropRoot as AssetLibraryRoot, folderId: assetDropFolder || null },
    key: assetDropKey ?? "",
  };
}

// Drags that start in another panel publish the library spot under the pointer here, so the
// library can light it up and open collapsed tree rows as it does for its own drags.
const externalDropTargetStore = createStore<{ target: AssetLibraryDropTarget | null }>(() => ({
  target: null,
}));

export function setExternalAssetLibraryDropTarget(target: AssetLibraryDropTarget | null) {
  const current = externalDropTargetStore.getState().target;
  if (current?.key === target?.key && current?.location.root === target?.location.root) return;
  externalDropTargetStore.setState({ target });
}

export function useExternalAssetLibraryDropTarget() {
  return useStore(externalDropTargetStore, (state) => state.target);
}

/**
 * The library folder a drag from another panel would land in: only the library that holds
 * the dragged kind of item accepts it. Publishes the hovered spot as a side effect.
 */
export function trackExternalAssetLibraryDrop(
  clientX: number,
  clientY: number,
  root: AssetLibraryRoot,
): AssetLibraryLocation | null {
  const target = assetLibraryDropTargetAt(clientX, clientY);
  const accepted = target?.location.root === root ? target : null;
  setExternalAssetLibraryDropTarget(accepted);
  return accepted?.location ?? null;
}
