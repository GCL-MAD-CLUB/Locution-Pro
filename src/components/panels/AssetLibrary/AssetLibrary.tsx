import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  FolderPlus,
  PanelLeft,
  PanelRight,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  assetLibraryChildren,
  assetLibraryClipboard,
  assetLibraryDescendants,
  assetLibraryEntryMatches,
  assetLibraryFolderDescendantIds,
  assetLibraryFolderPath,
  assetLibraryLocationExists,
  assetLibraryRootLabels,
  assetLibraryViewLayout,
  renamedAssetLibraryEntry,
  sortedAssetLibraryNodes,
  withAssetLibraryColorLabel,
  withAssetLibraryFlag,
  withAssetLibraryRating,
  withAssetLibraryRatingDelta,
  type AssetLibraryFlag,
  type AssetLibraryLocation,
  type AssetLibrarySelection,
} from "../../../core/editor/assetLibrary";
import { useEditCapability } from "../../../runtime/capabilities/EditCapability";
import { publishEvent } from "../../../runtime/events/react";
import { useStableIdentity } from "../../../runtime/state/react";
import { usePanelActive, usePanelInstanceId } from "../../../runtime/systems/PanelState";
import { useProjectPort } from "../../../systems/ProjectSystem";
import type { AssetLibraryColorLabel, AssetLibraryEntry } from "../../../types";
import { usePanelManagerState } from "../../common/DockLayout";
import { isPopupMenuEventTarget, useCloseOnOutsidePointer } from "../../common/PopupMenu";
import { annotationShortcutAction } from "../../common/utils/annotationShortcuts";
import "./AssetLibrary.css";
import { assetLibraryCommands } from "./assetLibraryCommands";
import { resolveAssetMedia } from "./assetLibraryMedia";
import {
  activeAssetLibraryDrag,
  assetEntryKey,
  assetFolderKey,
  assetLibraryDragType,
  assetLibrarySelectionFromKeys,
  assetLocationKey,
  beginAssetLibraryDrag,
  endAssetLibraryDrag,
  type AssetLibraryNode,
} from "./assetLibraryNodes";
import {
  readAssetLibraryClipboard,
  setAssetLibraryClipboard,
  useAssetLibraryClipboard,
  useAssetLibraryState,
} from "./assetLibraryState";
import {
  AssetLibraryContextMenu,
  type AssetLibraryContextMenuActions,
  type AssetLibraryContextMenuModel,
  type AssetLibraryContextMenuState,
} from "./views/AssetLibraryContextMenu";
import { AssetLibraryDetails } from "./views/AssetLibraryDetails";
import { AssetLibraryItems } from "./views/AssetLibraryItems";
import { AssetLibraryNavigation } from "./views/AssetLibraryNavigation";

const sizeStep = 5;
const contentDropKey = "content";

interface ContextMenuState extends AssetLibraryContextMenuState {
  /** For tree menus, the location that was right-clicked. */
  treeLocation?: AssetLibraryLocation;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return (
    element?.tagName === "INPUT" ||
    element?.tagName === "TEXTAREA" ||
    element?.tagName === "SELECT" ||
    Boolean(element?.isContentEditable)
  );
}

function sameLocation(left: AssetLibraryLocation, right: AssetLibraryLocation) {
  return left.root === right.root && left.folderId === right.folderId;
}

function selectionSize(selection: AssetLibrarySelection) {
  return selection.folderIds.length + selection.entryIds.length;
}

function nodeParent(node: AssetLibraryNode): AssetLibraryLocation {
  return node.kind === "folder"
    ? { root: node.folder.root, folderId: node.folder.parent_id }
    : { root: node.entry.root, folderId: node.entry.folder_id };
}

function folderMatches(name: string, query: string) {
  const lowered = name.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => lowered.includes(term));
}

export function AssetLibrary() {
  const panelInstanceId = usePanelInstanceId();
  const panelActive = usePanelActive();
  const focusedPanelId = usePanelManagerState((state) => state.focusedPanelId);
  const identity = useStableIdentity("asset-library", panelInstanceId);
  const isEditAuthority = panelActive && focusedPanelId === panelInstanceId;
  const {
    assetLibrary: library,
    mediaItems,
    projects,
    assetLibraryUpdated,
    messagePublished,
    activeVideoChanged,
  } = useProjectPort(
    ["assetLibrary", "mediaItems", "projects"],
    ["assetLibraryUpdated", "messagePublished", "activeVideoChanged"],
  );
  const view = useAssetLibraryState((state) => state);
  const { clipboard, cut } = useAssetLibraryClipboard();
  const commands = useMemo(() => assetLibraryCommands(assetLibraryUpdated), [assetLibraryUpdated]);
  const [columns, setColumns] = useState(1);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const locationValid = assetLibraryLocationExists(library, view.location);
  const location: AssetLibraryLocation = locationValid
    ? view.location
    : { root: view.location.root, folderId: null };
  const { replaceLocation } = view;
  useEffect(() => {
    if (!locationValid) replaceLocation({ root: view.location.root, folderId: null });
  }, [locationValid, replaceLocation, view.location.root]);

  const query = view.query.trim();
  const layout = assetLibraryViewLayout(view.size);
  const path = useMemo(
    () => assetLibraryFolderPath(library, location.folderId),
    [library, location.folderId],
  );

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

  const nodes = useMemo<AssetLibraryNode[]>(() => {
    const source = query
      ? assetLibraryDescendants(library, location)
      : assetLibraryChildren(library, location);
    const sorted = sortedAssetLibraryNodes(
      query ? source.folders.filter((folder) => folderMatches(folder.name, query)) : source.folders,
      query
        ? source.entries.filter((entry) => assetLibraryEntryMatches(entry, query))
        : source.entries,
      view.sort,
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
  }, [childCounts, library, location.folderId, location.root, mediaByEntryId, query, view.sort]);

  const nodeIndex = useMemo(() => new Map(nodes.map((node, index) => [node.key, index])), [nodes]);
  const selectedNodes = nodes.filter((node) => view.selectedKeys.has(node.key));
  const selection = assetLibrarySelectionFromKeys(selectedNodes.map((node) => node.key));
  const selectedEntryIds = selection.entryIds;

  // Drop selection keys whose nodes are no longer visible (deleted, moved, filtered).
  const { select } = view;
  useEffect(() => {
    const visible = [...view.selectedKeys].filter((key) => nodeIndex.has(key));
    if (visible.length !== view.selectedKeys.size) select(visible);
  }, [nodeIndex, select, view.selectedKeys]);

  const cutKeys = useMemo(
    () =>
      new Set(
        cut && clipboard
          ? [
              ...clipboard.topFolderIds.map(assetFolderKey),
              ...clipboard.topEntryIds.map(assetEntryKey),
            ]
          : [],
      ),
    [clipboard, cut],
  );

  function rootLabel(root: AssetLibraryLocation["root"]) {
    return assetLibraryRootLabels[root];
  }

  function selectOnly(key: string) {
    view.select([key], key, key);
  }

  function selectRange(fromKey: string, toKey: string, additive: boolean) {
    const from = nodeIndex.get(fromKey) ?? nodeIndex.get(toKey) ?? 0;
    const to = nodeIndex.get(toKey) ?? 0;
    const range = nodes.slice(Math.min(from, to), Math.max(from, to) + 1).map((node) => node.key);
    view.select(additive ? [...view.selectedKeys, ...range] : range, toKey, fromKey);
  }

  function updateSelectedEntries(
    label: string,
    recipe: (entry: AssetLibraryEntry) => AssetLibraryEntry,
  ) {
    if (selectedEntryIds.length > 0) commands.updateEntries(label, selectedEntryIds, recipe);
  }

  const setFlag = (flag: AssetLibraryFlag) =>
    updateSelectedEntries("设置旗标", (entry) => withAssetLibraryFlag(entry, flag));
  const setRating = (rating: number) =>
    updateSelectedEntries("设置星级", (entry) => withAssetLibraryRating(entry, rating));
  const setColorLabel = (colorLabel: AssetLibraryColorLabel | null) =>
    updateSelectedEntries("设置色标", (entry) => withAssetLibraryColorLabel(entry, colorLabel));

  function previewEntry(entry: AssetLibraryEntry) {
    const media = mediaByEntryId.get(entry.id);
    if (!media) {
      messagePublished(`“${entry.name}”的源媒体离线或已从项目移除，无法预览。`);
      return;
    }
    activeVideoChanged(media.videoId);
    void publishEvent("media.video.opened", { videoId: media.videoId }, identity);
    void publishEvent(
      "playback.seek.requested",
      { videoId: media.videoId, timeUs: entry.start_us, focusEndUs: entry.end_us },
      identity,
    );
    messagePublished(`已在源监视器中预览“${entry.name}”。`);
  }

  function openNode(node: AssetLibraryNode) {
    if (node.kind === "folder") {
      view.navigate({ root: node.folder.root, folderId: node.folder.id });
    } else {
      previewEntry(node.entry);
    }
  }

  function navigateUp() {
    if (!location.folderId) return;
    const parent = path.at(-2);
    view.navigate({ root: location.root, folderId: parent?.id ?? null });
    view.select([assetFolderKey(location.folderId)], assetFolderKey(location.folderId));
  }

  function createFolder(target: AssetLibraryLocation = location) {
    const folder = commands.createFolder(target);
    if (!folder) return;
    if (!sameLocation(target, location)) view.navigate(target);
    if (query) view.setQuery("");
    const key = assetFolderKey(folder.id);
    view.select([key], key, key);
    view.setRenamingKey(key);
  }

  function copyNodes(nodeSelection: AssetLibrarySelection, asCut: boolean) {
    const nextClipboard = assetLibraryClipboard(library, nodeSelection);
    if (!nextClipboard) return;
    setAssetLibraryClipboard(nextClipboard, asCut);
    const count = nextClipboard.topFolderIds.length + nextClipboard.topEntryIds.length;
    messagePublished(asCut ? `已剪切 ${count} 项。` : `已复制 ${count} 项。`);
  }

  function selectCreated(target: AssetLibraryLocation, folderIds: string[], entryIds: string[]) {
    if (!sameLocation(target, location) || query) return;
    const keys = [...folderIds.map(assetFolderKey), ...entryIds.map(assetEntryKey)];
    view.select(keys, keys.at(-1) ?? null, keys[0] ?? null);
  }

  function pasteInto(target: AssetLibraryLocation) {
    const { clipboard: current, cut: isCut } = readAssetLibraryClipboard();
    if (!current) return;
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
  }

  function duplicateNodes(nodeSelection: AssetLibrarySelection) {
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
    const keys = [...created.folderIds.map(assetFolderKey), ...created.entryIds.map(assetEntryKey)];
    view.select(keys, keys.at(-1) ?? null, keys[0] ?? null);
    messagePublished(`已创建 ${keys.length} 个副本。`);
  }

  function removeNodes(nodeSelection: AssetLibrarySelection) {
    if (selectionSize(nodeSelection) === 0) return;
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
  }

  function startRename(key: string | null) {
    if (key && nodeIndex.has(key)) view.setRenamingKey(key);
  }

  function renameNode(node: AssetLibraryNode, name: string) {
    view.setRenamingKey(null);
    if (node.kind === "folder") commands.renameFolder(node.folder.id, name);
    else {
      commands.updateEntries("重命名素材", [node.entry.id], (entry) =>
        renamedAssetLibraryEntry(entry, name),
      );
    }
  }

  useEditCapability({
    identity,
    active: isEditAuthority,
    selectedCount: selectedNodes.length,
    visibleCount: nodes.length,
    pasteCount: clipboard ? clipboard.topFolderIds.length + clipboard.topEntryIds.length : 0,
    handlers: {
      copy: () => copyNodes(selection, false),
      paste: () => pasteInto(location),
      clear: () => removeNodes(selection),
      duplicate: () => duplicateNodes(selection),
      selectAll: () => view.select(nodes.map((node) => node.key)),
      clearSelection: () => view.select([], null, null),
    },
  });

  // --- Pointer selection -------------------------------------------------------------

  function handleNodePointerDown(event: ReactPointerEvent<HTMLElement>, node: AssetLibraryNode) {
    const selected = view.selectedKeys.has(node.key);
    if (event.button === 2) {
      if (!selected) selectOnly(node.key);
      return;
    }
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!selected) selectOnly(node.key);
  }

  function handleNodeClick(event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode) {
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) {
      selectRange(view.anchorKey ?? node.key, node.key, additive);
    } else if (additive) {
      const keys = new Set(view.selectedKeys);
      if (keys.has(node.key)) keys.delete(node.key);
      else keys.add(node.key);
      view.select(keys, node.key, node.key);
    } else {
      selectOnly(node.key);
    }
  }

  // --- Drag and drop -----------------------------------------------------------------

  function dropAllowed(target: AssetLibraryLocation) {
    const drag = activeAssetLibraryDrag();
    if (!drag || drag.root !== target.root) return false;
    if (!target.folderId) return true;
    const dragged = assetLibrarySelectionFromKeys(drag.keys);
    return !assetLibraryFolderDescendantIds(library.folders, dragged.folderIds).has(
      target.folderId,
    );
  }

  function handleDragStart(event: DragEvent<HTMLElement>, node: AssetLibraryNode) {
    const keys = view.selectedKeys.has(node.key)
      ? selectedNodes.map((selected) => selected.key)
      : [node.key];
    if (!view.selectedKeys.has(node.key)) selectOnly(node.key);
    beginAssetLibraryDrag(keys, location.root);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(assetLibraryDragType, keys.join("\n"));
  }

  function handleDragEnd() {
    endAssetLibraryDrag();
    setDropTargetKey(null);
  }

  function handleDragOver(
    event: DragEvent<HTMLElement>,
    target: AssetLibraryLocation,
    key: string,
  ) {
    if (!dropAllowed(target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.ctrlKey || event.metaKey ? "copy" : "move";
    setDropTargetKey(key);
  }

  function handleDrop(event: DragEvent<HTMLElement>, target: AssetLibraryLocation) {
    const drag = activeAssetLibraryDrag();
    if (!drag || !dropAllowed(target)) return;
    event.preventDefault();
    event.stopPropagation();
    handleDragEnd();
    const dragged = assetLibrarySelectionFromKeys(drag.keys);
    if (event.ctrlKey || event.metaKey) {
      const dragClipboard = assetLibraryClipboard(library, dragged);
      if (!dragClipboard) return;
      const pasted = commands.paste(dragClipboard, target, "复制素材");
      messagePublished(`已复制 ${pasted.folderIds.length + pasted.entryIds.length} 项。`);
      return;
    }
    const movedCount = commands.move(dragged, target);
    if (movedCount > 0) messagePublished(`已移动 ${movedCount} 项。`);
  }

  const contentTarget = (folderId: string | null): AssetLibraryLocation =>
    folderId ? { root: location.root, folderId } : location;

  // --- Keyboard ------------------------------------------------------------------------

  function moveFocus(event: ReactKeyboardEvent<HTMLElement>, nextIndex: number) {
    const target = nodes[Math.min(nodes.length - 1, Math.max(0, nextIndex))];
    if (!target) return;
    event.preventDefault();
    if (event.shiftKey) selectRange(view.anchorKey ?? target.key, target.key, event.ctrlKey);
    else if (event.ctrlKey || event.metaKey) view.select(view.selectedKeys, target.key, target.key);
    else selectOnly(target.key);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (isEditableTarget(event.target) || isPopupMenuEventTarget(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (event.altKey && !ctrl) {
      if (key === "ArrowLeft") view.goBack();
      else if (key === "ArrowRight") view.goForward();
      else if (key === "ArrowUp") navigateUp();
      else return;
      event.preventDefault();
      return;
    }
    if (ctrl && event.shiftKey && key.toLocaleLowerCase() === "n") {
      event.preventDefault();
      createFolder();
      return;
    }
    if (ctrl && !event.shiftKey && key.toLocaleLowerCase() === "x") {
      event.preventDefault();
      copyNodes(selection, true);
      return;
    }
    const focusIndex = view.focusKey ? (nodeIndex.get(view.focusKey) ?? -1) : -1;
    const rowStep = layout.mode === "icons" ? columns : 1;
    const steps: Record<string, number> = {
      ArrowUp: -rowStep,
      ArrowDown: rowStep,
      ...(layout.mode === "icons" ? { ArrowLeft: -1, ArrowRight: 1 } : {}),
    };
    if (key in steps && !event.altKey) {
      moveFocus(event, focusIndex < 0 ? 0 : focusIndex + steps[key]!);
      return;
    }
    if (key === "Home") return moveFocus(event, 0);
    if (key === "End") return moveFocus(event, nodes.length - 1);
    if (ctrl) return;
    if (key === "Enter") {
      const node = nodes[focusIndex] ?? selectedNodes[0];
      if (node) {
        event.preventDefault();
        openNode(node);
      }
      return;
    }
    if (key === "F2") {
      event.preventDefault();
      startRename(selectedNodes.length === 1 ? selectedNodes[0]!.key : view.focusKey);
      return;
    }
    if (key === "Escape" && view.selectedKeys.size > 0) {
      event.preventDefault();
      view.select([], null, null);
      return;
    }
    const action =
      isEditAuthority && !event.repeat ? annotationShortcutAction(event.nativeEvent) : null;
    if (!action || selectedEntryIds.length === 0) return;
    event.preventDefault();
    if (action.kind === "flag") setFlag(action.value);
    else if (action.kind === "rating") setRating(action.value);
    else if (action.kind === "colorLabel") setColorLabel(action.value);
    else {
      updateSelectedEntries("调整星级", (entry) =>
        withAssetLibraryRatingDelta(entry, action.value),
      );
    }
  }

  // --- Context menu --------------------------------------------------------------------

  useCloseOnOutsidePointer(Boolean(menu), () => setMenu(null), {
    capturePointerdown: true,
    ignorePopupMenuTargets: true,
  });

  function openContentMenu(event: ReactMouseEvent<HTMLElement>, node: AssetLibraryNode | null) {
    event.preventDefault();
    event.stopPropagation();
    if (!node) view.select([], null, null);
    setMenu({ x: event.clientX, y: event.clientY, scope: "content" });
  }

  function openTreeMenu(event: ReactMouseEvent<HTMLElement>, treeLocation: AssetLibraryLocation) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, scope: "tree", treeLocation });
  }

  const menuTreeLocation = menu?.scope === "tree" ? menu.treeLocation : undefined;
  const menuSelection: AssetLibrarySelection = menuTreeLocation
    ? { folderIds: menuTreeLocation.folderId ? [menuTreeLocation.folderId] : [], entryIds: [] }
    : selection;
  const menuTarget = menuTreeLocation ?? location;
  const singleMenuNode = !menuTreeLocation && selectedNodes.length === 1 ? selectedNodes[0]! : null;
  const menuModel: AssetLibraryContextMenuModel = {
    canOpen: Boolean(singleMenuNode) || Boolean(menuTreeLocation),
    openLabel: singleMenuNode?.kind === "entry" ? "在源监视器中预览" : "打开",
    canCreateFolder: true,
    canCut: selectionSize(menuSelection) > 0,
    canCopy: selectionSize(menuSelection) > 0,
    canPaste: Boolean(clipboard) && clipboard?.root === menuTarget.root,
    canDuplicate: selectionSize(menuSelection) > 0,
    canRename: menuTreeLocation ? Boolean(menuTreeLocation.folderId) : Boolean(singleMenuNode),
    canDelete: selectionSize(menuSelection) > 0,
    hasEntries: !menuTreeLocation && selectedEntryIds.length > 0,
    sort: view.sort,
    navigationVisible: view.navigationVisible,
    detailsVisible: view.detailsVisible,
  };
  const menuActions: AssetLibraryContextMenuActions = {
    open: () => {
      if (menuTreeLocation) view.navigate(menuTreeLocation);
      else if (singleMenuNode) openNode(singleMenuNode);
    },
    createFolder: () => createFolder(menuTarget),
    cut: () => copyNodes(menuSelection, true),
    copy: () => copyNodes(menuSelection, false),
    paste: () => pasteInto(menuTarget),
    duplicate: () => duplicateNodes(menuSelection),
    rename: () => {
      if (!menuTreeLocation?.folderId) {
        startRename(singleMenuNode?.key ?? null);
        return;
      }
      const folder = library.folders.find(
        (candidate) => candidate.id === menuTreeLocation.folderId,
      );
      if (!folder) return;
      const key = assetFolderKey(folder.id);
      view.navigate({ root: folder.root, folderId: folder.parent_id });
      view.select([key], key, key);
      view.setRenamingKey(key);
    },
    remove: () => removeNodes(menuSelection),
    setFlag,
    setRating,
    setColorLabel,
    setSort: view.setSort,
    setNavigationVisible: view.setNavigationVisible,
    setDetailsVisible: view.setDetailsVisible,
  };

  // --- Rendering -----------------------------------------------------------------------

  const { setSize } = view;
  const size = view.size;
  const zoom = useCallback((steps: number) => setSize(size + steps * sizeStep), [setSize, size]);

  const locationLabel = query
    ? (node: AssetLibraryNode) => {
        const parent = nodeParent(node);
        if (sameLocation(parent, location)) return null;
        const names = assetLibraryFolderPath(library, parent.folderId)
          .slice(path.length)
          .map((folder) => folder.name);
        return names.join(" / ");
      }
    : undefined;

  const selectedFolderNode =
    selectedNodes.length === 1 && selectedNodes[0]!.kind === "folder" ? selectedNodes[0]! : null;
  const selectedEntryNodes = selectedNodes.flatMap((node) =>
    node.kind === "entry" ? [{ entry: node.entry, media: node.media }] : [],
  );
  const entryCount = nodes.filter((node) => node.kind === "entry").length;
  const folderCount = nodes.length - entryCount;

  return (
    <section
      ref={sectionRef}
      className="asset-library"
      tabIndex={-1}
      aria-label="素材库"
      onKeyDown={handleKeyDown}
    >
      <header className="asset-library-header">
        <div className="asset-library-nav-buttons">
          <button
            type="button"
            title="后退 (Alt+←)"
            disabled={view.backStack.length === 0}
            onClick={view.goBack}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            title="前进 (Alt+→)"
            disabled={view.forwardStack.length === 0}
            onClick={view.goForward}
          >
            <ArrowRight aria-hidden="true" />
          </button>
          <button
            type="button"
            title="上一级 (Alt+↑)"
            disabled={!location.folderId}
            onClick={navigateUp}
          >
            <ArrowUp aria-hidden="true" />
          </button>
        </div>
        <nav className="asset-library-breadcrumb" aria-label="当前位置">
          <button
            type="button"
            onClick={() => view.navigate({ root: location.root, folderId: null })}
          >
            {rootLabel(location.root)}
          </button>
          {path.map((folder) => (
            <span key={folder.id} className="asset-library-breadcrumb-part">
              <ChevronRight aria-hidden="true" />
              <button
                type="button"
                title={folder.name}
                onClick={() => view.navigate({ root: folder.root, folderId: folder.id })}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
        <label className="asset-library-search">
          <Search aria-hidden="true" />
          <input
            value={view.query}
            placeholder={`在“${path.at(-1)?.name ?? rootLabel(location.root)}”中搜索`}
            aria-label="搜索素材"
            onChange={(event) => view.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") view.setQuery("");
            }}
          />
          {view.query && (
            <button type="button" title="清除搜索" onClick={() => view.setQuery("")}>
              <X aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="asset-library-pane-buttons">
          <button
            type="button"
            className={view.navigationVisible ? "active" : ""}
            title="导航窗格"
            aria-pressed={view.navigationVisible}
            onClick={() => view.setNavigationVisible(!view.navigationVisible)}
          >
            <PanelLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className={view.detailsVisible ? "active" : ""}
            title="属性窗格"
            aria-pressed={view.detailsVisible}
            onClick={() => view.setDetailsVisible(!view.detailsVisible)}
          >
            <PanelRight aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className="asset-library-body"
        data-navigation={view.navigationVisible || undefined}
        data-details={view.detailsVisible || undefined}
      >
        {view.navigationVisible && (
          <AssetLibraryNavigation
            library={library}
            location={location}
            collapsedKeys={view.collapsedKeys}
            dropTargetKey={dropTargetKey}
            onNavigate={view.navigate}
            onToggleCollapsed={view.toggleCollapsed}
            onDragOverTarget={(event, target) =>
              handleDragOver(event, target, assetLocationKey(target))
            }
            onDragLeaveTarget={() => setDropTargetKey(null)}
            onDropOnTarget={handleDrop}
            onContextMenu={openTreeMenu}
          />
        )}
        <AssetLibraryItems
          nodes={nodes}
          layout={layout}
          selectedKeys={view.selectedKeys}
          focusKey={view.focusKey}
          renamingKey={view.renamingKey}
          cutKeys={cutKeys}
          dropTargetKey={dropTargetKey}
          thumbnailsEnabled={panelActive}
          emptyText={
            query
              ? "没有匹配的素材"
              : `此文件夹为空。可在${rootLabel(location.root)}面板中右键选择“添加到素材库”。`
          }
          locationLabel={locationLabel}
          onNodePointerDown={handleNodePointerDown}
          onNodeClick={handleNodeClick}
          onOpenNode={openNode}
          onMarqueeSelect={(keys) => view.select(keys)}
          onClearSelection={() => view.select([], null, null)}
          onRename={renameNode}
          onCancelRename={() => view.setRenamingKey(null)}
          onDragStartNode={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOverTarget={(event, folderId) =>
            handleDragOver(
              event,
              contentTarget(folderId),
              folderId ? assetFolderKey(folderId) : contentDropKey,
            )
          }
          onDragLeaveTarget={() => setDropTargetKey(null)}
          onDropOnTarget={(event, folderId) => handleDrop(event, contentTarget(folderId))}
          onContextMenu={openContentMenu}
          onColumnsChange={setColumns}
          onZoom={zoom}
        />
        {view.detailsVisible && (
          <AssetLibraryDetails
            folder={selectedFolderNode?.kind === "folder" ? selectedFolderNode : null}
            entries={selectedEntryNodes}
            thumbnailsEnabled={panelActive}
            onUpdateEntries={commands.updateEntries}
            onRenameFolder={commands.renameFolder}
            onPreview={previewEntry}
          />
        )}
      </div>

      <footer className="asset-library-footer">
        <div className="asset-library-view-tools">
          <input
            type="range"
            min="0"
            max="100"
            value={view.size}
            aria-label="显示大小"
            title={layout.mode === "list" ? "显示大小：列表" : "显示大小：图标"}
            onChange={(event) => view.setSize(Number(event.currentTarget.value))}
          />
        </div>
        <span className="asset-library-status">
          {folderCount > 0 && `${folderCount} 个文件夹，`}
          {entryCount} 个素材
          {selectedNodes.length > 0 && ` · 已选择 ${selectedNodes.length} 项`}
        </span>
        <div className="asset-library-action-tools">
          <button type="button" title="新建文件夹 (Ctrl+Shift+N)" onClick={() => createFolder()}>
            <FolderPlus aria-hidden="true" />
          </button>
          <button
            type="button"
            title="删除 (Delete)"
            disabled={selectedNodes.length === 0}
            onClick={() => removeNodes(selection)}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </footer>

      {menu && (
        <AssetLibraryContextMenu
          menu={menu}
          model={menuModel}
          actions={menuActions}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
