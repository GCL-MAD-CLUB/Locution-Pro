import type { AssetLibraryFolder, ProjectAssetLibraryState } from "../../types";
import type { AssetLibrarySelection } from "./assetLibrary";

/**
 * Sets the hidden flag on the selected folders and entries, as the media bin's "隐藏" column
 * does. Returns the library unchanged when nothing differs.
 */
export function withAssetLibraryNodesHidden(
  library: ProjectAssetLibraryState,
  selection: AssetLibrarySelection,
  hidden: boolean,
): ProjectAssetLibraryState {
  const folderIds = new Set(selection.folderIds);
  const entryIds = new Set(selection.entryIds);
  let changed = false;
  const folders = library.folders.map((folder) => {
    if (!folderIds.has(folder.id) || folder.hidden === hidden) return folder;
    changed = true;
    return { ...folder, hidden };
  });
  const entries = library.entries.map((entry) => {
    if (!entryIds.has(entry.id) || entry.hidden === hidden) return entry;
    changed = true;
    return { ...entry, hidden };
  });
  return changed ? { folders, entries } : library;
}

/**
 * Folders hidden themselves or under a hidden folder. A search lists every descendant, so it
 * leaves these out along with whatever they contain while hidden items are not shown.
 */
export function assetLibraryHiddenFolderIds(folders: readonly AssetLibraryFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const hidden = new Set<string>();
  for (const folder of folders) {
    const visited = new Set<string>();
    let current: AssetLibraryFolder | undefined = folder;
    while (current && !visited.has(current.id)) {
      if (current.hidden) {
        hidden.add(folder.id);
        break;
      }
      visited.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }
  return hidden;
}

/**
 * Leaves out hidden folders and entries. A search lists every descendant, so it also leaves
 * out whatever sits inside a hidden folder.
 */
export function withoutHiddenAssetLibraryNodes(
  library: ProjectAssetLibraryState,
  source: ProjectAssetLibraryState,
  searching: boolean,
): ProjectAssetLibraryState {
  const hiddenFolderIds = searching ? assetLibraryHiddenFolderIds(library.folders) : null;
  return {
    folders: source.folders.filter((folder) =>
      hiddenFolderIds ? !hiddenFolderIds.has(folder.id) : !folder.hidden,
    ),
    entries: source.entries.filter(
      (entry) => !entry.hidden && !(entry.folder_id && hiddenFolderIds?.has(entry.folder_id)),
    ),
  };
}

/** True when every selected folder and entry is hidden, and the selection is not empty. */
export function assetLibrarySelectionHidden(
  library: ProjectAssetLibraryState,
  selection: AssetLibrarySelection,
) {
  const folderIds = new Set(selection.folderIds);
  const entryIds = new Set(selection.entryIds);
  const folders = library.folders.filter((folder) => folderIds.has(folder.id));
  const entries = library.entries.filter((entry) => entryIds.has(entry.id));
  return (
    folders.length + entries.length > 0 &&
    folders.every((folder) => folder.hidden) &&
    entries.every((entry) => entry.hidden)
  );
}
