import type {
  AssetLibraryLocation,
  AssetLibrarySelection,
} from "../../../core/editor/assetLibrary";
import type { AssetLibraryEntry, AssetLibraryFolder } from "../../../types";
import type { ResolvedAssetMedia } from "./assetLibraryMedia";

export type AssetLibraryNode =
  | { kind: "folder"; key: string; folder: AssetLibraryFolder; childCount: number }
  | { kind: "entry"; key: string; entry: AssetLibraryEntry; media: ResolvedAssetMedia | null };

export function assetFolderKey(folderId: string) {
  return `folder:${folderId}`;
}

export function assetEntryKey(entryId: string) {
  return `entry:${entryId}`;
}

export function assetLibrarySelectionFromKeys(keys: Iterable<string>): AssetLibrarySelection {
  const folderIds: string[] = [];
  const entryIds: string[] = [];
  for (const key of keys) {
    if (key.startsWith("folder:")) folderIds.push(key.slice("folder:".length));
    else if (key.startsWith("entry:")) entryIds.push(key.slice("entry:".length));
  }
  return { folderIds, entryIds };
}

export function assetLibrarySelectionSize(selection: AssetLibrarySelection) {
  return selection.folderIds.length + selection.entryIds.length;
}

/** The folder that directly contains `node`. */
export function assetNodeParent(node: AssetLibraryNode): AssetLibraryLocation {
  return node.kind === "folder"
    ? { root: node.folder.root, folderId: node.folder.parent_id }
    : { root: node.entry.root, folderId: node.entry.folder_id };
}

export function assetLocationKey(location: AssetLibraryLocation) {
  return location.folderId ? assetFolderKey(location.folderId) : `root:${location.root}`;
}

export const assetLibraryDragType = "application/x-locution-pro-asset-library";

// Drag data cannot be read during dragover, so the active drag is kept here while it lasts.
let activeDrag: { keys: string[]; root: AssetLibraryLocation["root"] } | null = null;

export function beginAssetLibraryDrag(keys: string[], root: AssetLibraryLocation["root"]) {
  activeDrag = { keys, root };
}

export function activeAssetLibraryDrag() {
  return activeDrag;
}

export function endAssetLibraryDrag() {
  activeDrag = null;
}
