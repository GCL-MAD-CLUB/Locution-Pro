import {
  createAssetLibraryId,
  movedAssetLibraryNodes,
  pastedAssetLibraryNodes,
  removedAssetLibraryNodes,
  renamedAssetLibraryFolder,
  updatedAssetLibraryEntries,
  withAssetLibraryColorLabel,
  withAssetLibraryFlag,
  withAssetLibraryFolder,
  withAssetLibraryRating,
  withAssetLibraryRatingDelta,
  type AssetLibraryClipboard,
  type AssetLibraryFlag,
  type AssetLibraryLocation,
  type AssetLibrarySelection,
} from "../../../../core/editor/assetLibrary";
import { withAssetLibraryNodesHidden } from "../../../../core/editor/assetLibraryVisibility";
import type {
  AssetLibraryColorLabel,
  AssetLibraryEntry,
  AssetLibraryFolder,
  ProjectAssetLibraryState,
} from "../../../../types";
import type { AnnotationShortcutAction } from "../../../common/utils/annotationShortcuts";

export type AssetLibraryUpdate = (
  historyLabel: string,
  recipe: (library: ProjectAssetLibraryState) => ProjectAssetLibraryState,
  historyGroupId?: string,
) => void;

/**
 * Thin wrappers around the history-tracked library update. Each recipe runs synchronously
 * inside the store update, so results such as new ids are captured from the closure.
 */
export function assetLibraryCommands(update: AssetLibraryUpdate) {
  return {
    updateEntries(
      label: string,
      entryIds: readonly string[],
      recipe: (entry: AssetLibraryEntry) => AssetLibraryEntry,
      historyGroupId?: string,
    ) {
      update(
        label,
        (library) => updatedAssetLibraryEntries(library, entryIds, recipe),
        historyGroupId,
      );
    },

    createFolder(location: AssetLibraryLocation) {
      let folder: AssetLibraryFolder | null = null;
      update("新建文件夹", (library) => {
        const result = withAssetLibraryFolder(
          library,
          location,
          createAssetLibraryId("asset-folder"),
          Date.now(),
        );
        folder = result.folder;
        return result.library;
      });
      return folder as AssetLibraryFolder | null;
    },

    setHidden(selection: AssetLibrarySelection, hidden: boolean) {
      update(hidden ? "隐藏素材" : "取消隐藏素材", (library) =>
        withAssetLibraryNodesHidden(library, selection, hidden),
      );
    },

    renameFolder(folderId: string, name: string) {
      update("重命名文件夹", (library) => renamedAssetLibraryFolder(library, folderId, name));
    },

    remove(selection: AssetLibrarySelection) {
      let removed = 0;
      update("删除素材", (library) => {
        const next = removedAssetLibraryNodes(library, selection);
        removed =
          library.folders.length -
          next.folders.length +
          (library.entries.length - next.entries.length);
        return next;
      });
      return removed;
    },

    move(selection: AssetLibrarySelection, target: AssetLibraryLocation) {
      let movedCount = 0;
      update("移动素材", (library) => {
        const result = movedAssetLibraryNodes(library, selection, target);
        movedCount = result.movedCount;
        return result.library;
      });
      return movedCount;
    },

    paste(clipboard: AssetLibraryClipboard, target: AssetLibraryLocation, label = "粘贴素材") {
      let pasted = { folderIds: [] as string[], entryIds: [] as string[] };
      update(label, (library) => {
        const result = pastedAssetLibraryNodes(
          library,
          clipboard,
          target,
          createAssetLibraryId,
          Date.now(),
        );
        pasted = { folderIds: result.folderIds, entryIds: result.entryIds };
        return result.library;
      });
      return pasted;
    },

    /** Copies several groups in one history step, each next to its originals. */
    duplicate(
      copies: readonly { clipboard: AssetLibraryClipboard; target: AssetLibraryLocation }[],
    ) {
      const created = { folderIds: [] as string[], entryIds: [] as string[] };
      if (copies.length === 0) return created;
      update("创建副本", (library) =>
        copies.reduce((current, { clipboard, target }) => {
          const result = pastedAssetLibraryNodes(
            current,
            clipboard,
            target,
            createAssetLibraryId,
            Date.now(),
          );
          created.folderIds.push(...result.folderIds);
          created.entryIds.push(...result.entryIds);
          return result.library;
        }, library),
      );
      return created;
    },
  };
}

export type AssetLibraryCommands = ReturnType<typeof assetLibraryCommands>;

/** Flag, rating and color-label edits of the selected materials, each one history step. */
export function assetLibraryAnnotationActions(
  commands: ReturnType<typeof assetLibraryCommands>,
  entryIds: readonly string[],
) {
  const update = (label: string, recipe: (entry: AssetLibraryEntry) => AssetLibraryEntry) => {
    if (entryIds.length > 0) commands.updateEntries(label, entryIds, recipe);
  };
  const setFlag = (flag: AssetLibraryFlag) =>
    update("设置旗标", (entry) => withAssetLibraryFlag(entry, flag));
  const setRating = (rating: number) =>
    update("设置星级", (entry) => withAssetLibraryRating(entry, rating));
  const setColorLabel = (colorLabel: AssetLibraryColorLabel | null) =>
    update("设置色标", (entry) => withAssetLibraryColorLabel(entry, colorLabel));
  return {
    setFlag,
    setRating,
    setColorLabel,
    /** Applies a flag, rating or color-label keyboard shortcut. */
    applyShortcut(action: AnnotationShortcutAction) {
      if (action.kind === "flag") setFlag(action.value);
      else if (action.kind === "rating") setRating(action.value);
      else if (action.kind === "colorLabel") setColorLabel(action.value);
      else update("调整星级", (entry) => withAssetLibraryRatingDelta(entry, action.value));
    },
  };
}
