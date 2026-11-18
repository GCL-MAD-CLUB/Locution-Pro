import {
  isMediaItemEnabled,
  isMediaItemOffline,
  mediaItemProject,
} from "../../../../systems/ProjectSystem";
import type {
  AssetLibraryEntry,
  AssetLibraryFolder,
  AssetLibraryRoot,
  MediaBinItem,
  MediaDocument,
  ProjectAssetLibraryState,
} from "../../../../types";
import {
  assetLibraryFolderPath,
  assetLibraryProjectPlace,
  assetLibraryRootLabels,
  isAssetLibraryHomePlace,
  isAssetLibraryLocation,
  isAssetLibraryProjectPlace,
  type AssetLibraryLocation,
  type AssetLibraryPlace,
  type AssetLibrarySelection,
} from "../../../../core/editor/assetLibrary/assetLibrary";
import type { AssetLibraryGroupItem } from "../../../../core/editor/assetLibrary/assetLibraryGroup";

export interface ResolvedAssetMedia {
  videoId: string;
  assetId: string;
  fingerprint: string;
  videoPath: string;
  /** The proxy when one exists, for smooth hover scrubbing like the media bin. */
  previewPath: string;
}

export type AssetLibraryNode =
  | { kind: "folder"; key: string; folder: AssetLibraryFolder; childCount: number }
  | { kind: "entry"; key: string; entry: AssetLibraryEntry; media: ResolvedAssetMedia | null }
  /** One of the two libraries, listed when the project is open. It opens but cannot be edited. */
  | { kind: "library"; key: string; root: AssetLibraryRoot; childCount: number };

/** The place described when no item is selected: a folder, a library, or the project. */
export type AssetLibraryContainer =
  | { kind: "folder"; folder: AssetLibraryFolder; childCount: number }
  | { kind: "root"; root: AssetLibraryRoot }
  | { kind: "project" };

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

/** The full path of the folder holding `node`, such as 字幕:\文件夹1\文件夹2. */
export function assetNodeParentText(library: ProjectAssetLibraryState, node: AssetLibraryNode) {
  const parent = assetNodeParent(node);
  if (!isAssetLibraryLocation(parent)) return null;
  const names = assetLibraryFolderPath(library, parent.folderId).map((folder) => folder.name);
  return [`${assetLibraryRootLabels[parent.root]}:`, ...names].join("\\");
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
 * folder or library, or with nothing selected the open place (the project, a library or a folder);
 * the home describes nothing until something is selected.
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
  if (isAssetLibraryHomePlace(place)) return null;
  if (isAssetLibraryProjectPlace(place)) return { kind: "project" };
  if (!openFolder) return { kind: "root", root: place.root };
  return { kind: "folder", folder: openFolder, childCount: childCounts.get(openFolder.id) ?? 0 };
}

export function assetLocationKey(location: AssetLibraryPlace) {
  return location.folderId ? assetFolderKey(location.folderId) : `root:${location.root}`;
}

/**
 * Finds the project video an entry can play from. The captured video id is tried first;
 * if that item was removed or replaced, any enabled video with the same fingerprint works.
 */
export function resolveAssetMedia(
  entry: AssetLibraryEntry,
  mediaItems: readonly MediaBinItem[],
  projects: Record<string, MediaDocument>,
): ResolvedAssetMedia | null {
  const items = mediaItems as MediaBinItem[];
  const candidates = items.filter(
    (item) => item.kind === "video" && isMediaItemEnabled(item) && !isMediaItemOffline(item),
  );
  const resolve = (item: MediaBinItem | undefined) => {
    const project = item ? mediaItemProject(item, projects, items) : undefined;
    return item && project
      ? {
          videoId: item.id,
          assetId: project.asset.id,
          fingerprint: project.asset.fingerprint,
          videoPath: project.asset.path,
          previewPath: project.proxy_path || project.asset.path,
        }
      : null;
  };
  const direct = resolve(candidates.find((item) => item.id === entry.media.video_id));
  if (direct && (!entry.media.fingerprint || direct.fingerprint === entry.media.fingerprint)) {
    return direct;
  }
  if (!entry.media.fingerprint) return direct;
  for (const item of candidates) {
    const resolved = resolve(item);
    if (resolved?.fingerprint === entry.media.fingerprint) return resolved;
  }
  return null;
}
