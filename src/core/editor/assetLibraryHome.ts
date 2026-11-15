import type { AssetLibraryFolder, AssetLibraryRoot } from "../../types";
import { assetLibraryRoots } from "./assetLibrary";

// The asset library's home: folders pinned to quick access, favorite materials and recently
// used materials. Like a file manager's, it belongs to the user rather than the project, so it
// is kept beside the project instead of in it, and lists only ids that still exist.

export interface AssetLibraryRecentUse {
  entryId: string;
  usedAt: number;
}

export interface AssetLibraryHome {
  /**
   * Folders pinned to quick access, in pinning order. A library's top level is a folder too
   * and pins under its own id; see `assetLibraryPinnedRootId`.
   */
  pinnedFolderIds: string[];
  /** Favorite materials, the latest added first. */
  favoriteEntryIds: string[];
  /** Materials by their latest use, the latest first. */
  recent: AssetLibraryRecentUse[];
}

export type AssetLibraryHomeTab = "recent" | "favorites";

export const assetLibraryHomeLabel = "主文件夹";

/** The pin id of a library's top level, which matches its key among listed items. */
export function assetLibraryPinnedRootId(root: AssetLibraryRoot) {
  return `root:${root}`;
}

/** A pinned folder or library top level that still exists. */
export interface AssetLibraryPinnedPlace {
  id: string;
  root: AssetLibraryRoot;
  /** The folder, or null for a library's top level. */
  folder: AssetLibraryFolder | null;
}

/** Resolves the pins in order, leaving out folders that no longer exist. */
export function assetLibraryPinnedPlaces(
  home: AssetLibraryHome,
  folders: readonly AssetLibraryFolder[],
): AssetLibraryPinnedPlace[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  return home.pinnedFolderIds.flatMap((id): AssetLibraryPinnedPlace[] => {
    const root = assetLibraryRoots.find((candidate) => assetLibraryPinnedRootId(candidate) === id);
    if (root) return [{ id, root, folder: null }];
    const folder = byId.get(id);
    return folder ? [{ id, root: folder.root, folder }] : [];
  });
}

/** How many recently used materials are remembered. */
export const assetLibraryRecentLimit = 50;

export function emptyAssetLibraryHome(): AssetLibraryHome {
  return { pinnedFolderIds: [], favoriteEntryIds: [], recent: [] };
}

function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id)))];
}

/** Repairs a saved home; anything unreadable is dropped rather than failing the restore. */
export function normalizedAssetLibraryHome(saved: unknown): AssetLibraryHome {
  const value = (saved ?? {}) as Partial<Record<keyof AssetLibraryHome, unknown>>;
  const seen = new Set<string>();
  const recent = (Array.isArray(value.recent) ? value.recent : []).flatMap((use) => {
    const { entryId, usedAt } = (use ?? {}) as Partial<AssetLibraryRecentUse>;
    if (typeof entryId !== "string" || !entryId || seen.has(entryId)) return [];
    if (typeof usedAt !== "number" || !Number.isFinite(usedAt)) return [];
    seen.add(entryId);
    return [{ entryId, usedAt }];
  });
  return {
    pinnedFolderIds: uniqueIds(value.pinnedFolderIds),
    favoriteEntryIds: uniqueIds(value.favoriteEntryIds),
    recent: recent.slice(0, assetLibraryRecentLimit),
  };
}

/** Pinning appends to quick access; unpinning removes. Already pinned folders keep their place. */
export function withAssetLibraryPins(
  home: AssetLibraryHome,
  folderIds: readonly string[],
  pinned: boolean,
): AssetLibraryHome {
  const pinnedFolderIds = pinned
    ? [...new Set([...home.pinnedFolderIds, ...folderIds])]
    : home.pinnedFolderIds.filter((id) => !folderIds.includes(id));
  return { ...home, pinnedFolderIds };
}

/** New favorites go to the front, in the order given; existing favorites keep their place. */
export function withAssetLibraryFavorites(
  home: AssetLibraryHome,
  entryIds: readonly string[],
  favorite: boolean,
): AssetLibraryHome {
  const favoriteEntryIds = favorite
    ? [
        ...new Set([
          ...entryIds.filter((id) => !home.favoriteEntryIds.includes(id)),
          ...home.favoriteEntryIds,
        ]),
      ]
    : home.favoriteEntryIds.filter((id) => !entryIds.includes(id));
  return { ...home, favoriteEntryIds };
}

/** Moves a material to the front of the recently used list. */
export function withAssetLibraryUse(
  home: AssetLibraryHome,
  entryId: string,
  usedAt: number,
): AssetLibraryHome {
  const recent = [
    { entryId, usedAt },
    ...home.recent.filter((use) => use.entryId !== entryId),
  ].slice(0, assetLibraryRecentLimit);
  return { ...home, recent };
}

export function withoutAssetLibraryRecent(
  home: AssetLibraryHome,
  entryIds: readonly string[],
): AssetLibraryHome {
  return { ...home, recent: home.recent.filter((use) => !entryIds.includes(use.entryId)) };
}
