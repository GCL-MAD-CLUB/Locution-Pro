import { useMemo } from "react";
import {
  assetLibraryChildren,
  assetLibraryDescendants,
  assetLibraryEntryMatches,
  assetLibraryRoots,
  isAssetLibraryProjectPlace,
  sortedAssetLibraryNodes,
  type AssetLibraryPlace,
  type AssetLibrarySort,
} from "../../../core/editor/assetLibrary";
import {
  assetLibraryEntryMatchesFilter,
  assetLibraryFilterActive,
  type AssetLibraryFilter,
} from "../../../core/editor/assetLibraryFilter";
import { withoutHiddenAssetLibraryNodes } from "../../../core/editor/assetLibraryVisibility";
import type {
  AssetLibraryEntry,
  MediaBinItem,
  MediaDocument,
  ProjectAssetLibraryState,
} from "../../../types";
import { resolveAssetMedia } from "./assetLibraryMedia";
import {
  assetEntryKey,
  assetFolderKey,
  assetLocationKey,
  type AssetLibraryNode,
} from "./assetLibraryNodes";

function folderMatches(name: string, query: string) {
  const lowered = name.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => lowered.includes(term));
}

interface AssetLibraryNodesOptions {
  library: ProjectAssetLibraryState;
  location: AssetLibraryPlace;
  query: string;
  sort: AssetLibrarySort;
  filter: AssetLibraryFilter;
  showHidden: boolean;
  mediaItems: readonly MediaBinItem[];
  projects: Record<string, MediaDocument>;
}

/**
 * The items listed for a place: its children, or every matching descendant while searching,
 * without hidden items unless they are shown and without materials the filter leaves out.
 * Folders come first. The project lists the two libraries, and a search there covers both.
 */
export function useAssetLibraryNodes({
  library,
  location,
  query,
  sort,
  filter,
  showHidden,
  mediaItems,
  projects,
}: AssetLibraryNodesOptions) {
  const mediaByEntryId = useMemo(
    () =>
      new Map(
        library.entries.map((entry) => [entry.id, resolveAssetMedia(entry, mediaItems, projects)]),
      ),
    [library.entries, mediaItems, projects],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const add = (parentId: string | null) => {
      if (parentId) counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    };
    library.folders.forEach((folder) => add(folder.parent_id));
    library.entries.forEach((entry) => add(entry.folder_id));
    return counts;
  }, [library]);

  const { root, folderId } = location;
  const nodes = useMemo<AssetLibraryNode[]>(() => {
    const at = { root, folderId } as AssetLibraryPlace;
    const filtering = assetLibraryFilterActive(filter);
    const kept = (entries: readonly AssetLibraryEntry[]) =>
      entries.filter(
        (entry) =>
          (!query || assetLibraryEntryMatches(entry, query)) &&
          (!filtering || assetLibraryEntryMatchesFilter(entry, filter)),
      );
    if (isAssetLibraryProjectPlace(at) && !query) {
      return assetLibraryRoots.map((libraryRoot) => {
        const top = assetLibraryChildren(library, { root: libraryRoot, folderId: null });
        const visible = showHidden ? top : withoutHiddenAssetLibraryNodes(library, top, false);
        const shown = { ...visible, entries: kept(visible.entries) };
        return {
          kind: "library" as const,
          key: assetLocationKey({ root: libraryRoot, folderId: null }),
          root: libraryRoot,
          childCount: shown.folders.length + shown.entries.length,
        };
      });
    }
    const all = isAssetLibraryProjectPlace(at)
      ? library
      : query
        ? assetLibraryDescendants(library, at)
        : assetLibraryChildren(library, at);
    const source = showHidden ? all : withoutHiddenAssetLibraryNodes(library, all, Boolean(query));
    const sorted = sortedAssetLibraryNodes(
      query ? source.folders.filter((folder) => folderMatches(folder.name, query)) : source.folders,
      kept(source.entries),
      sort,
    );
    return [
      ...sorted.folders.map((folder) => ({
        kind: "folder" as const,
        key: assetFolderKey(folder.id),
        folder,
        childCount: childCounts.get(folder.id) ?? 0,
      })),
      ...sorted.entries.map((entry) => ({
        kind: "entry" as const,
        key: assetEntryKey(entry.id),
        entry,
        media: mediaByEntryId.get(entry.id) ?? null,
      })),
    ];
  }, [childCounts, filter, folderId, library, mediaByEntryId, query, root, showHidden, sort]);

  return { nodes, mediaByEntryId, childCounts };
}
