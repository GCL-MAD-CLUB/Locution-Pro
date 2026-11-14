import {
  ArrowUpDown,
  ChevronDown,
  CirclePlus,
  ClipboardPaste,
  Copy,
  Ellipsis,
  LayoutList,
  ListFilter,
  PanelRight,
  Scissors,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AssetLibrarySort } from "../../../../core/editor/assetLibrary";
import {
  assetLibraryFilterActive,
  emptyAssetLibraryFilter,
  type AssetLibraryFilter,
} from "../../../../core/editor/assetLibraryFilter";
import type { AssetLibraryGrouping } from "../../../../core/editor/assetLibraryGroup";
import {
  PopupMenu,
  PopupMenuItem,
  PopupMenuSeparator,
  PopupMenuSubmenu,
  useCloseOnOutsidePointer,
} from "../../../common/PopupMenu";
import {
  AssetLibraryGroupItems,
  AssetLibrarySortItems,
  AssetLibraryViewPresetItems,
} from "./AssetLibraryContextMenu";
import { AssetLibraryFilterItems } from "./AssetLibraryFilterItems";

export interface AssetLibraryCommandBarModel {
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canRename: boolean;
  canDelete: boolean;
  hasItems: boolean;
  hasSelection: boolean;
  sort: AssetLibrarySort;
  group: AssetLibraryGrouping;
  filter: AssetLibraryFilter;
  size: number;
  navigationVisible: boolean;
  detailsVisible: boolean;
  itemCheckboxes: boolean;
  showHidden: boolean;
}

export interface AssetLibraryCommandBarActions {
  createFolder: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  rename: () => void;
  remove: () => void;
  setSort: (sort: AssetLibrarySort) => void;
  setGroup: (group: AssetLibraryGrouping) => void;
  setFilter: (filter: AssetLibraryFilter) => void;
  setSize: (size: number) => void;
  setNavigationVisible: (visible: boolean) => void;
  setDetailsVisible: (visible: boolean) => void;
  setItemCheckboxes: (visible: boolean) => void;
  setShowHidden: (visible: boolean) => void;
  selectAll: () => void;
  selectNone: () => void;
  invertSelection: () => void;
  showProperties: () => void;
}

type CommandMenu = "new" | "sort" | "view" | "filter" | "more";

/**
 * File-manager command bar: create, clipboard, rename and delete, then sort, view, filter
 * and more.
 */
export function AssetLibraryCommandBar({
  model,
  actions,
}: {
  model: AssetLibraryCommandBarModel;
  actions: AssetLibraryCommandBarActions;
}) {
  const [menu, setMenu] = useState<{ kind: CommandMenu; x: number; y: number } | null>(null);
  /** The one submenu of the open menu: 分组依据 under 排序, 显示 under 查看. */
  const [submenuOpen, setSubmenuOpen] = useState(false);
  useCloseOnOutsidePointer(Boolean(menu), () => setMenu(null), {
    capturePointerdown: true,
    ignorePopupMenuTargets: true,
  });

  function close() {
    setMenu(null);
    setSubmenuOpen(false);
  }

  function run(action: () => void) {
    return () => {
      close();
      action();
    };
  }

  function openMenu(event: ReactMouseEvent<HTMLButtonElement>, kind: CommandMenu) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setSubmenuOpen(false);
    setMenu({ kind, x: bounds.left, y: bounds.bottom + 2 });
  }

  function commandButton(
    Icon: LucideIcon,
    label: string,
    shortcut: string,
    enabled: boolean,
    action: () => void,
  ) {
    return (
      <button
        type="button"
        title={`${label} (${shortcut})`}
        aria-label={label}
        disabled={!enabled}
        onClick={action}
      >
        <Icon aria-hidden="true" />
      </button>
    );
  }

  function menuButton(kind: CommandMenu, Icon: LucideIcon, label: string | null, on = false) {
    const open = menu?.kind === kind;
    return (
      <button
        type="button"
        className={`asset-library-command-menu-button${label ? "" : " is-icon"}${open ? " active" : ""}${on ? " is-on" : ""}`}
        title={label ?? "更多选项"}
        aria-label={label ?? "更多选项"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => openMenu(event, kind)}
      >
        <Icon aria-hidden="true" />
        {label && (
          <>
            <span>{label}</span>
            <ChevronDown className="asset-library-command-chevron" aria-hidden="true" />
          </>
        )}
      </button>
    );
  }

  function menuItems(kind: CommandMenu): ReactNode {
    switch (kind) {
      case "new":
        return (
          <PopupMenuItem shortcut="Ctrl+Shift+N" onSelect={run(actions.createFolder)}>
            文件夹
          </PopupMenuItem>
        );
      case "sort":
        return (
          <>
            <AssetLibrarySortItems
              sort={model.sort}
              onSelect={(sort) => run(() => actions.setSort(sort))()}
            />
            <PopupMenuSeparator />
            <PopupMenuSubmenu label="分组依据" open={submenuOpen} onOpenChange={setSubmenuOpen}>
              <AssetLibraryGroupItems
                group={model.group}
                onSelect={(group) => run(() => actions.setGroup(group))()}
              />
            </PopupMenuSubmenu>
          </>
        );
      case "view":
        return (
          <>
            <AssetLibraryViewPresetItems
              size={model.size}
              onSelect={(size) => run(() => actions.setSize(size))()}
            />
            <PopupMenuSeparator />
            <PopupMenuSubmenu label="显示" open={submenuOpen} onOpenChange={setSubmenuOpen}>
              <PopupMenuItem
                checked={model.navigationVisible}
                onSelect={run(() => actions.setNavigationVisible(!model.navigationVisible))}
              >
                导航窗格
              </PopupMenuItem>
              <PopupMenuItem
                checked={model.detailsVisible}
                shortcut="Alt+Shift+P"
                onSelect={run(() => actions.setDetailsVisible(!model.detailsVisible))}
              >
                属性窗格
              </PopupMenuItem>
              <PopupMenuSeparator />
              <PopupMenuItem
                checked={model.itemCheckboxes}
                onSelect={run(() => actions.setItemCheckboxes(!model.itemCheckboxes))}
              >
                项目复选框
              </PopupMenuItem>
              <PopupMenuItem
                checked={model.showHidden}
                onSelect={run(() => actions.setShowHidden(!model.showHidden))}
              >
                隐藏的项目
              </PopupMenuItem>
            </PopupMenuSubmenu>
          </>
        );
      case "filter":
        return (
          <AssetLibraryFilterItems
            filter={model.filter}
            onChange={actions.setFilter}
            onClear={run(() => actions.setFilter(emptyAssetLibraryFilter))}
          />
        );
      case "more":
        return (
          <>
            <PopupMenuItem
              shortcut="Ctrl+A"
              disabled={!model.hasItems}
              onSelect={run(actions.selectAll)}
            >
              全选
            </PopupMenuItem>
            <PopupMenuItem disabled={!model.hasSelection} onSelect={run(actions.selectNone)}>
              全部取消
            </PopupMenuItem>
            <PopupMenuItem disabled={!model.hasItems} onSelect={run(actions.invertSelection)}>
              反向选择
            </PopupMenuItem>
            <PopupMenuSeparator />
            <PopupMenuItem shortcut="Alt+Enter" onSelect={run(actions.showProperties)}>
              属性
            </PopupMenuItem>
          </>
        );
    }
  }

  return (
    <div className="asset-library-command-bar" role="toolbar" aria-label="素材库命令">
      {menuButton("new", CirclePlus, "新建")}
      <span className="asset-library-command-separator" aria-hidden="true" />
      {commandButton(Scissors, "剪切", "Ctrl+X", model.canCut, actions.cut)}
      {commandButton(Copy, "复制", "Ctrl+C", model.canCopy, actions.copy)}
      {commandButton(ClipboardPaste, "粘贴", "Ctrl+V", model.canPaste, actions.paste)}
      {commandButton(TextCursorInput, "重命名", "F2", model.canRename, actions.rename)}
      {commandButton(Trash2, "删除", "Delete", model.canDelete, actions.remove)}
      <span className="asset-library-command-separator" aria-hidden="true" />
      {menuButton("sort", ArrowUpDown, "排序")}
      {menuButton("view", LayoutList, "查看")}
      {menuButton("filter", ListFilter, "筛选", assetLibraryFilterActive(model.filter))}
      <span className="asset-library-command-separator" aria-hidden="true" />
      {menuButton("more", Ellipsis, null)}
      <button
        type="button"
        className="asset-library-command-pane-toggle"
        title={`${model.detailsVisible ? "隐藏" : "显示"}属性窗格 (Alt+Shift+P)`}
        aria-label={`${model.detailsVisible ? "隐藏" : "显示"}属性窗格`}
        onClick={() => actions.setDetailsVisible(!model.detailsVisible)}
      >
        <PanelRight aria-hidden="true" />
        <span>属性</span>
      </button>
      {menu &&
        createPortal(
          <PopupMenu
            className="asset-library-context-menu"
            contextMenuAnchor={menu}
            ariaLabel="素材库命令"
            style={{ position: "fixed", left: menu.x, top: menu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {menuItems(menu.kind)}
          </PopupMenu>,
          document.body,
        )}
    </div>
  );
}
