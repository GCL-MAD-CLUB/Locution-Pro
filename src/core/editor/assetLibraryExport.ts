import type {
  AssetLibraryEntry,
  AssetLibraryFolder,
  AssetLibraryRoot,
  ProjectAssetLibraryState,
} from "../../types";
import { assetLibraryFolderDescendantIds } from "./assetLibrary";
import { assetLibraryHiddenFolderIds } from "./assetLibraryVisibility";

/** What an export acts on: whole libraries, folders with everything inside them, and materials. */
export interface AssetLibraryExportSelection {
  roots: readonly AssetLibraryRoot[];
  folderIds: readonly string[];
  entryIds: readonly string[];
}

/**
 * The materials an export covers, in library order and each once. Selected folders and
 * libraries contribute everything nested inside them; while hidden items are not shown,
 * hidden materials and the contents of hidden folders stay out unless selected directly.
 */
export function assetLibraryExportEntries(
  library: ProjectAssetLibraryState,
  selection: AssetLibraryExportSelection,
  showHidden: boolean,
): AssetLibraryEntry[] {
  const roots = new Set(selection.roots);
  const entryIds = new Set(selection.entryIds);
  const folderIds = assetLibraryFolderDescendantIds(library.folders, selection.folderIds);
  const hiddenFolderIds = showHidden
    ? new Set<string>()
    : assetLibraryHiddenFolderIds(library.folders);
  const selectedHidden = new Set(selection.folderIds.filter((id) => hiddenFolderIds.has(id)));
  const foldersById = new Map(library.folders.map((folder) => [folder.id, folder]));
  return library.entries.filter((entry) => {
    if (entryIds.has(entry.id)) return true;
    const inside =
      roots.has(entry.root) || (entry.folder_id !== null && folderIds.has(entry.folder_id));
    if (!inside || (!showHidden && entry.hidden)) return false;
    if (!entry.folder_id || !hiddenFolderIds.has(entry.folder_id)) return true;
    // A hidden folder chosen on purpose still exports, but not hidden folders inside it.
    return folderVisibleBelow(foldersById, entry.folder_id, selectedHidden);
  });
}

/** True when no folder between `folderId` and a selected hidden folder is hidden itself. */
function folderVisibleBelow(
  foldersById: ReadonlyMap<string, AssetLibraryFolder>,
  folderId: string,
  selectedHidden: ReadonlySet<string>,
) {
  const visited = new Set<string>();
  let current = foldersById.get(folderId);
  while (current && !visited.has(current.id)) {
    if (selectedHidden.has(current.id)) return true;
    if (current.hidden) return false;
    visited.add(current.id);
    current = current.parent_id ? foldersById.get(current.parent_id) : undefined;
  }
  return false;
}
