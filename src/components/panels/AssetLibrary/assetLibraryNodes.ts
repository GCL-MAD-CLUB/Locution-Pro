import {
  assetLibraryRootLabels,
  assetLibraryProjectPlace,
  isAssetLibraryProjectPlace,
  type AssetLibraryLocation,
  type AssetLibraryPlace,
  type AssetLibrarySelection,
} from "../../../core/editor/assetLibrary";
import type { AssetLibraryGroupItem } from "../../../core/editor/assetLibraryGroup";
import type { AssetLibraryEntry, AssetLibraryFolder, AssetLibraryRoot } from "../../../types";
import type { ResolvedAssetMedia } from "./assetLibraryMedia";
import type { AssetLibraryContainer } from "./views/AssetLibraryDetails";

export type AssetLibraryNode =
  | { kind: "folder"; key: string; folder: AssetLibraryFolder; childCount: number }
  | { kind: "entry"; key: string; entry: AssetLibraryEntry; media: ResolvedAssetMedia | null }
  /** One of the two libraries, listed when the project is open. It opens but cannot be edited. */
  | { kind: "library"; key: string; root: AssetLibraryRoot; childCount: number };

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
export function assetNodeParent(node: AssetLibraryNode): AssetLibraryPlace {
  if (node.kind === "library") return assetLibraryProjectPlace;
  return node.kind === "folder"
    ? { root: node.folder.root, folderId: node.folder.parent_id }
    : { root: node.entry.root, folderId: node.entry.folder_id };
}

/** The place a folder or library item opens; entries do not open as places. */
export function assetNodeTarget(node: AssetLibraryNode): AssetLibraryLocation | null {
  if (node.kind === "library") return { root: node.root, folderId: null };
  return node.kind === "folder" ? { root: node.folder.root, folderId: node.folder.id } : null;
}

export function assetNodeGroupItem(node: AssetLibraryNode): AssetLibraryGroupItem {
  switch (node.kind) {
    case "library":
      return {
        kind: "library",
        name: assetLibraryRootLabels[node.root],
        createdAt: null,
        entry: null,
      };
    case "folder":
      return {
        kind: "folder",
        name: node.folder.name,
        createdAt: node.folder.created_at,
        entry: null,
      };
    case "entry":
      return {
        kind: "entry",
        name: node.entry.name,
        createdAt: node.entry.created_at,
        entry: node.entry,
      };
  }
}

/**
 * What the properties pane describes besides entries: as in a file manager, a single selected
 * folder or library, or with nothing selected the open place (the project, a library or a folder).
 */
export function assetLibraryDetailsContainer(
  selectedNodes: readonly AssetLibraryNode[],
  place: AssetLibraryPlace,
  openFolder: AssetLibraryFolder | undefined,
  childCounts: ReadonlyMap<string, number>,
): AssetLibraryContainer | null {
  const single = selectedNodes.length === 1 ? selectedNodes[0]! : null;
  if (single?.kind === "folder") return { ...single, kind: "folder" };
  if (single?.kind === "library") return { kind: "root", root: single.root };
  if (selectedNodes.length > 0) return null;
  if (isAssetLibraryProjectPlace(place)) return { kind: "project" };
  if (!openFolder) return { kind: "root", root: place.root };
  return { kind: "folder", folder: openFolder, childCount: childCounts.get(openFolder.id) ?? 0 };
}

export function assetLocationKey(location: AssetLibraryPlace) {
  return location.folderId ? assetFolderKey(location.folderId) : `root:${location.root}`;
}
