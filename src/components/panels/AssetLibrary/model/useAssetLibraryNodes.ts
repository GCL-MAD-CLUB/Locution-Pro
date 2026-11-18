import { useCallback, useMemo } from "react";
import type { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { useClock } from "../../../../runtime/state/useClock";
import {
  assetLibraryChildren,
  assetLibraryDescendants,
  assetLibraryEntryMatches,
  assetLibraryFolderPath,
  assetLibraryRoots,
  isAssetLibraryHomePlace,
  isAssetLibraryLocation,
  isAssetLibraryProjectPlace,
  sortedAssetLibraryNodes,
  type AssetLibraryPlace,
  type AssetLibrarySort,
} from "../../../../core/editor/assetLibrary/assetLibrary";
import {
  assetLibraryEntryMatchesFilter,
  assetLibraryFilterActive,
  type AssetLibraryFilter,
} from "../../../../core/editor/assetLibrary/assetLibraryFilter";
import {
  groupedAssetLibraryItems,
  type AssetLibraryGrouping,
} from "../../../../core/editor/assetLibrary/assetLibraryGroup";
import {
  assetLibraryPinnedPlaces,
  type AssetLibraryHome,
  type AssetLibraryHomeTab,
} from "../../../../core/editor/assetLibrary/assetLibraryHome";
import { withoutHiddenAssetLibraryNodes } from "../../../../core/editor/assetLibrary/assetLibraryVisibility";
import type {
  AssetLibraryEntry,
  AssetLibraryFolder,
  AssetLibraryRoot,
  MediaBinItem,
  MediaDocument,
  ProjectAssetLibraryState,
} from "../../../../types";
import {
  assetEntryKey,
  assetFolderKey,
  assetLocationKey,
  assetNodeGroupItem,
  resolveAssetMedia,
  type AssetLibraryNode,
} from "./nodes";

/** A group of listed items; a collapsed group's items are left out of the navigable nodes. */
export interface AssetLibraryNodeGroup {
  id: string;
  label: string;
  nodes: readonly AssetLibraryNode[];
  collapsed: boolean;
  /** Index of the group's first item among the navigable nodes. */
  start: number;
}

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
  group: AssetLibraryGrouping;
  collapsedGroups: ReadonlySet<string>;
  showHidden: boolean;
  home: AssetLibraryHome;
  homeTab: AssetLibraryHomeTab;
  mediaItems: readonly MediaBinItem[];
  projects: Record<string, MediaDocument>;
}

/**
 * The items listed for a place: its children, or every matching descendant while searching,
 * without hidden items unless they are shown and without materials the filter leaves out.
 * Folders come first. The project lists the two libraries, and a search there covers both.
 * The home lists the folders and libraries pinned to quick access, then the recently used or favorite
 * materials in their own order; a search there also covers both libraries.
 * When grouped, `nodes` follows the group order and leaves out collapsed groups, while
 * `itemCount` still counts every listed item.
 */
export function useAssetLibraryNodes(
  lifetime: RenderLifetime,
  {
    library,
    location,
    query,
    sort,
    filter,
    group,
    collapsedGroups,
    showHidden,
    home,
    homeTab,
    mediaItems,
    projects,
  }: AssetLibraryNodesOptions,
) {
  const now = useClock(lifetime);
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

  // Sorting by location compares full folder paths, as the location column shows them.
  const locationText = useCallback(
    (libraryRoot: AssetLibraryRoot, parentId: string | null) =>
      [libraryRoot, ...assetLibraryFolderPath(library, parentId).map((folder) => folder.name)].join(
        "\\",
      ),
    [library],
  );

  const { root, folderId } = location;
  const listed = useMemo<AssetLibraryNode[]>(() => {
    const at = { root, folderId } as AssetLibraryPlace;
    const filtering = assetLibraryFilterActive(filter);
    const kept = (entries: readonly AssetLibraryEntry[]) =>
      entries.filter(
        (entry) =>
          (!query || assetLibraryEntryMatches(entry, query)) &&
          (!filtering || assetLibraryEntryMatchesFilter(entry, filter)),
      );
    const folderNodes = (folders: readonly AssetLibraryFolder[]) =>
      folders.map((folder) => ({
        kind: "folder" as const,
        key: assetFolderKey(folder.id),
        folder,
        childCount: childCounts.get(folder.id) ?? 0,
      }));
    const entryNodes = (entries: readonly AssetLibraryEntry[]) =>
      entries.map((entry) => ({
        kind: "entry" as const,
        key: assetEntryKey(entry.id),
        entry,
        media: mediaByEntryId.get(entry.id) ?? null,
      }));
    const libraryNode = (libraryRoot: AssetLibraryRoot) => {
      const top = assetLibraryChildren(library, { root: libraryRoot, folderId: null });
      const visible = showHidden ? top : withoutHiddenAssetLibraryNodes(library, top, false);
      return {
        kind: "library" as const,
        key: assetLocationKey({ root: libraryRoot, folderId: null }),
        root: libraryRoot,
        childCount: visible.folders.length + kept(visible.entries).length,
      };
    };
    if (isAssetLibraryHomePlace(at) && !query) {
      const entriesById = new Map(library.entries.map((entry) => [entry.id, entry]));
      const entryIds =
        homeTab === "recent" ? home.recent.map((use) => use.entryId) : home.favoriteEntryIds;
      const shortcuts = {
        folders: assetLibraryPinnedPlaces(home, library.folders).flatMap(
          (pinned) => pinned.folder ?? [],
        ),
        entries: entryIds.flatMap((id) => entriesById.get(id) ?? []),
      };
      const source = showHidden
        ? shortcuts
        : withoutHiddenAssetLibraryNodes(library, shortcuts, true);
      const shownFolderIds = new Set(source.folders.map((folder) => folder.id));
      // Pinned folders and libraries keep their pinning order.
      const pinned = assetLibraryPinnedPlaces(home, source.folders).flatMap(
        (place): AssetLibraryNode[] =>
          place.folder
            ? shownFolderIds.has(place.folder.id)
              ? folderNodes([place.folder])
              : []
            : [libraryNode(place.root)],
      );
      return [...pinned, ...entryNodes(kept(source.entries))];
    }
    if (isAssetLibraryProjectPlace(at) && !query) return assetLibraryRoots.map(libraryNode);
    const all = !isAssetLibraryLocation(at)
      ? library
      : query
        ? assetLibraryDescendants(library, at)
        : assetLibraryChildren(library, at);
    const source = showHidden ? all : withoutHiddenAssetLibraryNodes(library, all, Boolean(query));
    const sorted = sortedAssetLibraryNodes(
      query ? source.folders.filter((folder) => folderMatches(folder.name, query)) : source.folders,
      kept(source.entries),
      sort,
      locationText,
    );
    return [...folderNodes(sorted.folders), ...entryNodes(sorted.entries)];
  }, [
    childCounts,
    filter,
    folderId,
    home,
    homeTab,
    library,
    locationText,
    mediaByEntryId,
    query,
    root,
    showHidden,
    sort,
  ]);

  // The home keeps its own order and sections, so it is never grouped unless searched.
  const grouping = root === "home" && !query ? null : group.key;
  const { nodes, groups } = useMemo(() => {
    if (!grouping) return { nodes: listed, groups: null };
    let start = 0;
    const grouped = groupedAssetLibraryItems(listed, assetNodeGroupItem, group, now).map(
      ({ id, label, items }): AssetLibraryNodeGroup => {
        const collapsed = collapsedGroups.has(id);
        const result = { id, label, nodes: items, collapsed, start };
        if (!collapsed) start += items.length;
        return result;
      },
    );
    return {
      nodes: grouped.flatMap((entry) => (entry.collapsed ? [] : entry.nodes)),
      groups: grouped,
    };
  }, [collapsedGroups, group, grouping, listed, now]);

  return { nodes, groups, itemCount: listed.length, mediaByEntryId, childCounts };
}
