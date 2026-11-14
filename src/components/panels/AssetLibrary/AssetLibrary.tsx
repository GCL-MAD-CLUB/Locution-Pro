import { Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  assetLibraryChildren,
  assetLibraryDescendants,
  assetLibraryEntryMatches,
  assetLibraryFolderPath,
  assetLibraryLocationExists,
  assetLibraryRootLabels,
  assetLibraryViewLayout,
  sameAssetLibraryLocation,
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
import { assetLibraryDragDrop, type AssetLibraryDragPreview } from "./assetLibraryDragDrop";
import { assetLibraryFileOperations } from "./assetLibraryFileOperations";
import {
  assetLibraryButtonKeys,
  assetLibraryKeyCommand,
  isAssetLibraryEditableTarget,
  type AssetLibraryKeyCommand,
} from "./assetLibraryKeyboard";
import { resolveAssetMedia } from "./assetLibraryMedia";
import {
  assetEntryKey,
  assetFolderKey,
  assetLibrarySelectionFromKeys,
  assetLibrarySelectionSize,
  assetLocationKey,
  assetNodeParent,
  type AssetLibraryNode,
} from "./assetLibraryNodes";
import { useAssetLibraryClipboard, useAssetLibraryState } from "./assetLibraryState";
import { AssetLibraryAddressBar } from "./views/AssetLibraryAddressBar";
import {
  AssetLibraryCommandBar,
  type AssetLibraryCommandBarActions,
  type AssetLibraryCommandBarModel,
} from "./views/AssetLibraryCommandBar";
import {
  AssetLibraryContextMenu,
  type AssetLibraryContextMenuActions,
  type AssetLibraryContextMenuModel,
  type AssetLibraryContextMenuState,
} from "./views/AssetLibraryContextMenu";
import { AssetLibraryDetails } from "./views/AssetLibraryDetails";
import { AssetLibraryDragPreview as DragPreview } from "./views/AssetLibraryDragPreview";
import { AssetLibraryFooter } from "./views/AssetLibraryFooter";
import { AssetLibraryItems } from "./views/AssetLibraryItems";
import { AssetLibraryNavigation } from "./views/AssetLibraryNavigation";
import { AssetLibraryResizeHandle } from "./views/AssetLibraryResizeHandle";

const sizeStep = 5;
const minimumItemsWidth = 160;
interface ContextMenuState extends AssetLibraryContextMenuState {
  /** For tree menus, the location that was right-clicked. */
  treeLocation?: AssetLibraryLocation;
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
  const [dragPreview, setDragPreview] = useState<AssetLibraryDragPreview | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [addressEditing, setAddressEditing] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

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

  // As in a file manager's navigation pane, the tree always reveals the current folder.
  const { expandKeys } = view;
  useEffect(() => {
    expandKeys([
      assetLocationKey({ root: location.root, folderId: null }),
      ...path.slice(0, -1).map((folder) => assetFolderKey(folder.id)),
    ]);
  }, [expandKeys, location.root, path]);

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

  function toggleNodeSelected(node: AssetLibraryNode) {
    const keys = new Set(view.selectedKeys);
    if (keys.has(node.key)) keys.delete(node.key);
    else keys.add(node.key);
    view.select(keys, node.key, node.key);
  }

  function selectAll() {
    view.select(nodes.map((node) => node.key));
  }

  function toggleAllSelected() {
    if (nodes.length > 0 && selectedNodes.length === nodes.length) view.select([], null, null);
    else selectAll();
  }

  function invertSelection() {
    view.select(nodes.filter((node) => !view.selectedKeys.has(node.key)).map((node) => node.key));
  }

  function showProperties() {
    view.setDetailsVisible(true);
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

  const { createFolder, copyNodes, pasteInto, duplicateNodes, removeNodes, renameNode } =
    assetLibraryFileOperations({
      library,
      location,
      path,
      query,
      commands,
      view,
      messagePublished,
    });

  function startRename(key: string | null) {
    if (key && nodeIndex.has(key)) view.setRenamingKey(key);
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
      selectAll,
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
    if (event.button !== 0) return;
    startNodeDrag(event, node);
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
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

  const { startNodeDrag } = assetLibraryDragDrop({
    library,
    location,
    selectedKeys: view.selectedKeys,
    selectedNodes,
    selectOnly,
    setDropTargetKey,
    setPreview: setDragPreview,
    cleanupRef: dragCleanupRef,
    commands,
    messagePublished,
  });

  // --- Keyboard ------------------------------------------------------------------------

  function openKeyboardMenu() {
    const section = sectionRef.current;
    const focused = view.focusKey
      ? section?.querySelector<HTMLElement>(`[data-asset-key="${CSS.escape(view.focusKey)}"]`)
      : null;
    const anchor = focused ?? section?.querySelector<HTMLElement>(".asset-library-items");
    if (!anchor) return;
    const bounds = anchor.getBoundingClientRect();
    if (!focused) view.select([], null, null);
    setMenu({
      x: bounds.left + 16,
      y: focused ? bounds.bottom : bounds.top + 16,
      scope: "content",
    });
  }

  function focusSearch() {
    searchRef.current?.focus();
    searchRef.current?.select();
  }

  function runKeyCommand(command: AssetLibraryKeyCommand, focusIndex: number) {
    switch (command.kind) {
      case "back":
        return view.goBack();
      case "forward":
        return view.goForward();
      case "up":
        return navigateUp();
      case "properties":
        return showProperties();
      case "toggleDetails":
        return view.setDetailsVisible(!view.detailsVisible);
      case "address":
        return setAddressEditing(true);
      case "search":
        return focusSearch();
      case "contextMenu":
        return openKeyboardMenu();
      case "viewPreset":
        return view.setSize(command.size);
      case "newFolder":
        return createFolder();
      case "cut":
        return copyNodes(selection, true);
      case "toggleFocused":
        return toggleNodeSelected(nodes[focusIndex]!);
      case "move": {
        const target = nodes[command.index]!;
        if (command.extend) {
          selectRange(view.anchorKey ?? target.key, target.key, command.keepSelection);
        } else if (command.keepSelection) {
          view.select(view.selectedKeys, target.key, target.key);
        } else {
          selectOnly(target.key);
        }
        return;
      }
      case "open": {
        const node = nodes[focusIndex] ?? selectedNodes[0];
        return node && openNode(node);
      }
      case "rename":
        return startRename(selectedNodes.length === 1 ? selectedNodes[0]!.key : view.focusKey);
      case "clearSelection":
        return view.select([], null, null);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (isAssetLibraryEditableTarget(event.target) || isPopupMenuEventTarget(event.target)) return;
    const target = event.target as HTMLElement;
    // The properties pane keeps its keys; focused buttons keep activation and arrow keys.
    if (target.closest?.(".asset-library-details")) return;
    if (target.closest?.("button") && !event.altKey && assetLibraryButtonKeys.has(event.key))
      return;
    const focusIndex = view.focusKey ? (nodeIndex.get(view.focusKey) ?? -1) : -1;
    const command = assetLibraryKeyCommand(event, {
      itemCount: nodes.length,
      focusIndex,
      iconColumns: layout.mode === "icons" ? columns : null,
      hasSelection: view.selectedKeys.size > 0,
    });
    if (command) {
      const opensNothing =
        (command.kind === "open" && !nodes[focusIndex] && !selectedNodes[0]) ||
        (command.kind === "rename" && selectedNodes.length !== 1 && !view.focusKey);
      if (!opensNothing) event.preventDefault();
      runKeyCommand(command, focusIndex);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
    canCut: assetLibrarySelectionSize(menuSelection) > 0,
    canCopy: assetLibrarySelectionSize(menuSelection) > 0,
    canPaste: Boolean(clipboard) && clipboard?.root === menuTarget.root,
    canDuplicate: assetLibrarySelectionSize(menuSelection) > 0,
    canRename: menuTreeLocation ? Boolean(menuTreeLocation.folderId) : Boolean(singleMenuNode),
    canDelete: assetLibrarySelectionSize(menuSelection) > 0,
    canSelectAll: nodes.length > 0,
    hasEntries: !menuTreeLocation && selectedEntryIds.length > 0,
    sort: view.sort,
    size: view.size,
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
    selectAll,
    showProperties: () => {
      if (menuTreeLocation) view.navigate(menuTreeLocation);
      showProperties();
    },
    setFlag,
    setRating,
    setColorLabel,
    setSort: view.setSort,
    setSize: view.setSize,
    setDetailsVisible: view.setDetailsVisible,
  };

  // --- Command bar ---------------------------------------------------------------------

  // Commands hand focus back to the panel so keyboard shortcuts keep working afterwards.
  const refocus = (action: () => void) => () => {
    action();
    sectionRef.current?.focus({ preventScroll: true });
  };
  const singleSelected = selectedNodes.length === 1 ? selectedNodes[0]! : null;
  const commandModel: AssetLibraryCommandBarModel = {
    canCut: selectedNodes.length > 0,
    canCopy: selectedNodes.length > 0,
    canPaste: Boolean(clipboard) && clipboard?.root === location.root,
    canRename: Boolean(singleSelected),
    canDelete: selectedNodes.length > 0,
    hasItems: nodes.length > 0,
    hasSelection: selectedNodes.length > 0,
    sort: view.sort,
    size: view.size,
    detailsVisible: view.detailsVisible,
    itemCheckboxes: view.itemCheckboxes,
  };
  const commandActions: AssetLibraryCommandBarActions = {
    createFolder: () => createFolder(),
    cut: refocus(() => copyNodes(selection, true)),
    copy: refocus(() => copyNodes(selection, false)),
    paste: refocus(() => pasteInto(location)),
    rename: refocus(() => startRename(singleSelected?.key ?? null)),
    remove: refocus(() => removeNodes(selection)),
    setSort: view.setSort,
    setSize: view.setSize,
    setDetailsVisible: view.setDetailsVisible,
    setItemCheckboxes: view.setItemCheckboxes,
    selectAll: refocus(selectAll),
    selectNone: refocus(() => view.select([], null, null)),
    invertSelection: refocus(invertSelection),
    showProperties,
  };

  // --- Rendering -----------------------------------------------------------------------

  const { setSize, setPaneWidth, size } = view;
  const zoom = useCallback((steps: number) => setSize(size + steps * sizeStep), [setSize, size]);

  const locationLabel = query
    ? (node: AssetLibraryNode) => {
        const parent = assetNodeParent(node);
        if (sameAssetLibraryLocation(parent, location)) return null;
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
  // Side panes shrink before the item frame drops below its minimum width.
  const gridTemplateColumns = [
    `minmax(0, ${view.paneWidths.navigation}px) 4px`,
    `minmax(${minimumItemsWidth}px, 1fr)`,
    view.detailsVisible ? `4px minmax(0, ${view.paneWidths.details}px)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={sectionRef}
      className="media-bin-panel asset-library"
      tabIndex={-1}
      aria-label="素材库"
      onKeyDown={handleKeyDown}
    >
      <AssetLibraryAddressBar
        library={library}
        location={location}
        path={path}
        backStack={view.backStack}
        forwardStack={view.forwardStack}
        editing={addressEditing}
        dropTargetKey={dropTargetKey}
        onEditingChange={(editing) => {
          setAddressEditing(editing);
          if (!editing) sectionRef.current?.focus({ preventScroll: true });
        }}
        onNavigate={view.navigate}
        onGoBack={view.goBack}
        onGoForward={view.goForward}
        onNavigateUp={navigateUp}
        onInvalidPath={(text) => messagePublished(`素材库中找不到“${text}”。请检查拼写并重试。`)}
      />

      <div className="media-bin-search-row">
        <label className="media-bin-search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            value={view.query}
            placeholder={`在“${path.at(-1)?.name ?? rootLabel(location.root)}”中搜索`}
            aria-label="搜索素材"
            onChange={(event) => view.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") view.setQuery("");
            }}
          />
        </label>
        <span>
          {selectedNodes.length} 项已选择，共 {nodes.length} 项
        </span>
      </div>

      <AssetLibraryCommandBar model={commandModel} actions={commandActions} />

      <div className="asset-library-content" style={{ gridTemplateColumns }}>
        <AssetLibraryNavigation
          sort={view.sort}
          library={library}
          location={location}
          collapsedKeys={view.collapsedKeys}
          dropTargetKey={dropTargetKey}
          onNavigate={view.navigate}
          onToggleCollapsed={view.toggleCollapsed}
          onCreateFolder={() => createFolder()}
          onContextMenu={openTreeMenu}
        />
        <AssetLibraryResizeHandle
          pane="navigation"
          label="调整文件夹窗格宽度"
          width={view.paneWidths.navigation}
          onWidthChange={setPaneWidth}
        />
        <AssetLibraryItems
          root={location.root}
          location={location}
          nodes={nodes}
          layout={layout}
          sort={view.sort}
          selectedKeys={view.selectedKeys}
          focusKey={view.focusKey}
          renamingKey={view.renamingKey}
          cutKeys={cutKeys}
          dropTargetKey={dropTargetKey}
          thumbnailsEnabled={panelActive}
          emptyText={query ? "没有匹配的素材" : "此文件夹为空。"}
          locationLabel={locationLabel}
          visibleColumns={view.visibleColumns[location.root]}
          columnWidths={view.columnWidths[location.root]}
          itemCheckboxes={view.itemCheckboxes}
          onSort={view.setSort}
          onToggleColumn={view.toggleColumn}
          onColumnWidthChange={view.setColumnWidth}
          onResetColumnWidths={view.resetColumnWidths}
          onToggleNodeSelected={toggleNodeSelected}
          onToggleAllSelected={toggleAllSelected}
          onNodePointerDown={handleNodePointerDown}
          onNodeClick={handleNodeClick}
          onOpenNode={openNode}
          onMarqueeSelect={(keys) => view.select(keys)}
          onClearSelection={() => view.select([], null, null)}
          onRename={renameNode}
          onCancelRename={() => view.setRenamingKey(null)}
          onContextMenu={openContentMenu}
          onColumnsChange={setColumns}
          onZoom={zoom}
        />
        {view.detailsVisible && (
          <>
            <AssetLibraryResizeHandle
              pane="details"
              label="调整属性窗格宽度"
              width={view.paneWidths.details}
              onWidthChange={setPaneWidth}
            />
            <AssetLibraryDetails
              folder={selectedFolderNode?.kind === "folder" ? selectedFolderNode : null}
              entries={selectedEntryNodes}
              thumbnailsEnabled={panelActive}
              collapsedSections={view.collapsedSections}
              onToggleSection={view.toggleSection}
              onUpdateEntries={commands.updateEntries}
              onRenameFolder={commands.renameFolder}
              onPreview={previewEntry}
            />
          </>
        )}
      </div>

      <AssetLibraryFooter
        size={view.size}
        listMode={layout.mode === "list"}
        canDelete={selectedNodes.length > 0}
        onSizeChange={view.setSize}
        onCreateFolder={() => createFolder()}
        onDelete={() => removeNodes(selection)}
      />

      {menu && (
        <AssetLibraryContextMenu
          menu={menu}
          model={menuModel}
          actions={menuActions}
          onClose={() => setMenu(null)}
        />
      )}
      <DragPreview preview={dragPreview} />
    </section>
  );
}
