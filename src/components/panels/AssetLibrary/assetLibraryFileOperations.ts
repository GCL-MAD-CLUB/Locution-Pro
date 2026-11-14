import {
  assetLibraryClipboard,
  assetLibraryFolderDescendantIds,
  assetLibraryProjectLabel,
  assetLibraryRootLabels,
  isAssetLibraryProjectPlace,
  renamedAssetLibraryEntry,
  sameAssetLibraryLocation,
  type AssetLibraryLocation,
  type AssetLibraryPlace,
  type AssetLibrarySelection,
} from "../../../core/editor/assetLibrary";
import type { AssetLibraryFolder, ProjectAssetLibraryState } from "../../../types";
import type { AssetLibraryCommands } from "./assetLibraryCommands";
import {
  assetEntryKey,
  assetFolderKey,
  assetLibrarySelectionSize,
  assetLocationKey,
  type AssetLibraryNode,
} from "./assetLibraryNodes";
import { readAssetLibraryClipboard, setAssetLibraryClipboard } from "./assetLibraryState";

export interface AssetLibraryFileOperationContext {
  library: ProjectAssetLibraryState;
  location: AssetLibraryPlace;
  path: readonly AssetLibraryFolder[];
  query: string;
  commands: AssetLibraryCommands;
  view: {
    navigate: (location: AssetLibraryPlace) => void;
    replaceLocation: (location: AssetLibraryPlace) => void;
    select: (keys: Iterable<string>, focusKey?: string | null, anchorKey?: string | null) => void;
    setQuery: (query: string) => void;
    setRenamingKey: (key: string | null) => void;
  };
  messagePublished: (message: string) => void;
}

/** Create, clipboard, duplicate, delete and rename, with the file-manager feedback for each. */
export function assetLibraryFileOperations(context: AssetLibraryFileOperationContext) {
  const { library, location, path, query, commands, view, messagePublished } = context;
  const rootLabel = (root: AssetLibraryLocation["root"]) => assetLibraryRootLabels[root];

  function selectCreated(target: AssetLibraryLocation, folderIds: string[], entryIds: string[]) {
    if (!sameAssetLibraryLocation(target, location) || query) return;
    const keys = [...folderIds.map(assetFolderKey), ...entryIds.map(assetEntryKey)];
    view.select(keys, keys.at(-1) ?? null, keys[0] ?? null);
  }

  return {
    createFolder(target: AssetLibraryPlace = location) {
      // The project holds only the two libraries.
      if (isAssetLibraryProjectPlace(target)) return;
      const folder = commands.createFolder(target);
      if (!folder) return;
      if (!sameAssetLibraryLocation(target, location)) view.navigate(target);
      if (query) view.setQuery("");
      const key = assetFolderKey(folder.id);
      view.select([key], key, key);
      view.setRenamingKey(key);
    },

    copyNodes(nodeSelection: AssetLibrarySelection, asCut: boolean) {
      const nextClipboard = assetLibraryClipboard(library, nodeSelection);
      if (!nextClipboard) return;
      setAssetLibraryClipboard(nextClipboard, asCut);
      const count = nextClipboard.topFolderIds.length + nextClipboard.topEntryIds.length;
      messagePublished(asCut ? `已剪切 ${count} 项。` : `已复制 ${count} 项。`);
    },

    pasteInto(target: AssetLibraryPlace) {
      const { clipboard: current, cut: isCut } = readAssetLibraryClipboard();
      if (!current) return;
      if (isAssetLibraryProjectPlace(target)) {
        messagePublished(
          `不能粘贴到“${assetLibraryProjectLabel}”，请先打开“${rootLabel(current.root)}”。`,
        );
        return;
      }
      if (current.root !== target.root) {
        messagePublished(`${rootLabel(current.root)}素材不能粘贴到“${rootLabel(target.root)}”。`);
        return;
      }
      const cutSelection = { folderIds: current.topFolderIds, entryIds: current.topEntryIds };
      const originalsExist =
        library.folders.some((folder) => cutSelection.folderIds.includes(folder.id)) ||
        library.entries.some((entry) => cutSelection.entryIds.includes(entry.id));
      if (isCut && originalsExist) {
        const movedCount = commands.move(cutSelection, target);
        setAssetLibraryClipboard(null);
        selectCreated(target, cutSelection.folderIds, cutSelection.entryIds);
        messagePublished(movedCount > 0 ? `已移动 ${movedCount} 项。` : "所选项目已在此位置。");
        return;
      }
      const pasted = commands.paste(current, target);
      if (isCut) setAssetLibraryClipboard(null);
      selectCreated(target, pasted.folderIds, pasted.entryIds);
      messagePublished(`已粘贴 ${pasted.folderIds.length + pasted.entryIds.length} 项。`);
    },

    duplicateNodes(nodeSelection: AssetLibrarySelection) {
      const groups = new Map<
        string,
        { target: AssetLibraryLocation; selection: AssetLibrarySelection }
      >();
      const add = (target: AssetLibraryLocation, kind: "folderIds" | "entryIds", id: string) => {
        const key = assetLocationKey(target);
        const group = groups.get(key) ?? { target, selection: { folderIds: [], entryIds: [] } };
        groups.set(key, {
          target,
          selection: { ...group.selection, [kind]: [...group.selection[kind], id] },
        });
      };
      library.folders
        .filter((folder) => nodeSelection.folderIds.includes(folder.id))
        .forEach((folder) =>
          add({ root: folder.root, folderId: folder.parent_id }, "folderIds", folder.id),
        );
      library.entries
        .filter((entry) => nodeSelection.entryIds.includes(entry.id))
        .forEach((entry) =>
          add({ root: entry.root, folderId: entry.folder_id }, "entryIds", entry.id),
        );
      const copies = [...groups.values()].flatMap(({ target, selection: groupSelection }) => {
        const groupClipboard = assetLibraryClipboard(library, groupSelection);
        return groupClipboard ? [{ clipboard: groupClipboard, target }] : [];
      });
      const created = commands.duplicate(copies);
      const keys = [
        ...created.folderIds.map(assetFolderKey),
        ...created.entryIds.map(assetEntryKey),
      ];
      view.select(keys, keys.at(-1) ?? null, keys[0] ?? null);
      messagePublished(`已创建 ${keys.length} 个副本。`);
    },

    removeNodes(nodeSelection: AssetLibrarySelection) {
      if (assetLibrarySelectionSize(nodeSelection) === 0) return;
      const removedFolders = assetLibraryFolderDescendantIds(
        library.folders,
        nodeSelection.folderIds,
      );
      const survivor = [...path].reverse().find((folder) => !removedFolders.has(folder.id));
      const removed = commands.remove(nodeSelection);
      if (location.folderId && removedFolders.has(location.folderId)) {
        view.replaceLocation({ root: location.root, folderId: survivor?.id ?? null });
      }
      view.select([], null, null);
      if (removed > 0) messagePublished(`已从素材库删除 ${removed} 项，可通过撤销恢复。`);
    },

    renameNode(node: AssetLibraryNode, name: string) {
      view.setRenamingKey(null);
      if (node.kind === "folder") commands.renameFolder(node.folder.id, name);
      else if (node.kind === "entry") {
        commands.updateEntries("重命名素材", [node.entry.id], (entry) =>
          renamedAssetLibraryEntry(entry, name),
        );
      }
    },
  };
}
