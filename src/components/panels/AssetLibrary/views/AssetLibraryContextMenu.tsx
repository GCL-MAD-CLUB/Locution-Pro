import { useState } from "react";
import { createPortal } from "react-dom";
import {
  assetLibraryColorLabels,
  assetLibraryViewPresetForSize,
  assetLibraryViewPresets,
  type AssetLibraryFlag,
  type AssetLibrarySort,
  type AssetLibrarySortKey,
} from "../../../../core/editor/assetLibrary";
import type { AssetLibraryColorLabel } from "../../../../types";
import {
  PopupMenu,
  PopupMenuItem,
  PopupMenuSeparator,
  PopupMenuSubmenu,
} from "../../../common/PopupMenu";
import { assetLibraryColorLabelNames } from "./AssetLibraryBadges";

export interface AssetLibraryContextMenuState {
  x: number;
  y: number;
  /** "content" menus act on the selection; "tree" menus act on one navigation location. */
  scope: "content" | "tree";
}

export interface AssetLibraryContextMenuModel {
  canOpen: boolean;
  openLabel: string;
  canCreateFolder: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canDuplicate: boolean;
  canRename: boolean;
  canDelete: boolean;
  canSelectAll: boolean;
  hasEntries: boolean;
  /** Whether the menu acts on items; a menu on blank space or a library root does not. */
  hasItems: boolean;
  /** Every item the menu acts on is hidden, so "隐藏" shows checked and unhides them. */
  itemsHidden: boolean;
  showHidden: boolean;
  sort: AssetLibrarySort;
  size: number;
}

export interface AssetLibraryContextMenuActions {
  open: () => void;
  createFolder: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  rename: () => void;
  remove: () => void;
  selectAll: () => void;
  showProperties: () => void;
  setFlag: (flag: AssetLibraryFlag) => void;
  setRating: (rating: number) => void;
  setColorLabel: (colorLabel: AssetLibraryColorLabel | null) => void;
  setSort: (sort: AssetLibrarySort) => void;
  setSize: (size: number) => void;
  setHidden: (hidden: boolean) => void;
  setShowHidden: (visible: boolean) => void;
}

type Submenu = "flag" | "rating" | "color" | "sort" | "view" | null;

const sortLabels: Record<AssetLibrarySortKey, string> = {
  name: "名称",
  created: "添加时间",
  start: "入点",
  duration: "时长",
  rating: "星级",
};

/** Sort keys and direction, shared by the right-click menu and the command bar. */
export function AssetLibrarySortItems({
  sort,
  onSelect,
}: {
  sort: AssetLibrarySort;
  onSelect: (sort: AssetLibrarySort) => void;
}) {
  return (
    <>
      {(Object.keys(sortLabels) as AssetLibrarySortKey[]).map((key) => (
        <PopupMenuItem
          key={key}
          checked={sort.key === key}
          indicator="dot"
          onSelect={() => onSelect({ ...sort, key })}
        >
          {sortLabels[key]}
        </PopupMenuItem>
      ))}
      <PopupMenuSeparator />
      <PopupMenuItem
        checked={sort.direction === "ascending"}
        indicator="dot"
        onSelect={() => onSelect({ ...sort, direction: "ascending" })}
      >
        递增
      </PopupMenuItem>
      <PopupMenuItem
        checked={sort.direction === "descending"}
        indicator="dot"
        onSelect={() => onSelect({ ...sort, direction: "descending" })}
      >
        递减
      </PopupMenuItem>
    </>
  );
}

/** View presets; each sets the size slider, which then picks list or icons. */
export function AssetLibraryViewPresetItems({
  size,
  onSelect,
}: {
  size: number;
  onSelect: (size: number) => void;
}) {
  const current = assetLibraryViewPresetForSize(size);
  return (
    <>
      {assetLibraryViewPresets.map((preset) => (
        <PopupMenuItem
          key={preset.id}
          checked={current?.id === preset.id}
          indicator="dot"
          shortcut={preset.shortcut}
          onSelect={() => onSelect(preset.size)}
        >
          {preset.label}
        </PopupMenuItem>
      ))}
    </>
  );
}

export function AssetLibraryContextMenu({
  menu,
  model,
  actions,
  onClose,
}: {
  menu: AssetLibraryContextMenuState;
  model: AssetLibraryContextMenuModel;
  actions: AssetLibraryContextMenuActions;
  onClose: () => void;
}) {
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const toggle = (name: Exclude<Submenu, null>) => (open: boolean) =>
    setSubmenu(open ? name : null);
  return createPortal(
    <PopupMenu
      className="asset-library-context-menu"
      contextMenuAnchor={menu}
      ariaLabel="素材库操作"
      style={{ position: "fixed", left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {model.canOpen && (
        <>
          <PopupMenuItem shortcut="Enter" onSelect={run(actions.open)}>
            {model.openLabel}
          </PopupMenuItem>
          <PopupMenuSeparator />
        </>
      )}
      <PopupMenuItem
        shortcut="Ctrl+Shift+N"
        disabled={!model.canCreateFolder}
        onSelect={run(actions.createFolder)}
      >
        新建文件夹
      </PopupMenuItem>
      <PopupMenuSeparator />
      <PopupMenuItem shortcut="Ctrl+X" disabled={!model.canCut} onSelect={run(actions.cut)}>
        剪切
      </PopupMenuItem>
      <PopupMenuItem shortcut="Ctrl+C" disabled={!model.canCopy} onSelect={run(actions.copy)}>
        复制
      </PopupMenuItem>
      <PopupMenuItem shortcut="Ctrl+V" disabled={!model.canPaste} onSelect={run(actions.paste)}>
        粘贴
      </PopupMenuItem>
      <PopupMenuItem disabled={!model.canDuplicate} onSelect={run(actions.duplicate)}>
        创建副本
      </PopupMenuItem>
      <PopupMenuSeparator />
      <PopupMenuItem shortcut="F2" disabled={!model.canRename} onSelect={run(actions.rename)}>
        重命名
      </PopupMenuItem>
      <PopupMenuItem shortcut="Delete" disabled={!model.canDelete} onSelect={run(actions.remove)}>
        删除
      </PopupMenuItem>
      {menu.scope === "content" && (
        <PopupMenuItem
          shortcut="Ctrl+A"
          disabled={!model.canSelectAll}
          onSelect={run(actions.selectAll)}
        >
          全选
        </PopupMenuItem>
      )}
      {model.hasEntries && (
        <>
          <PopupMenuSeparator />
          <PopupMenuSubmenu
            label="设置旗标"
            open={submenu === "flag"}
            onOpenChange={toggle("flag")}
          >
            <PopupMenuItem shortcut="P" onSelect={run(() => actions.setFlag("retained"))}>
              留用
            </PopupMenuItem>
            <PopupMenuItem shortcut="U" onSelect={run(() => actions.setFlag("none"))}>
              无旗标
            </PopupMenuItem>
            <PopupMenuItem shortcut="X" onSelect={run(() => actions.setFlag("excluded"))}>
              排除
            </PopupMenuItem>
          </PopupMenuSubmenu>
          <PopupMenuSubmenu
            label="设置星级"
            open={submenu === "rating"}
            onOpenChange={toggle("rating")}
          >
            {[0, 1, 2, 3, 4, 5].map((rating) => (
              <PopupMenuItem
                key={rating}
                shortcut={String(rating)}
                onSelect={run(() => actions.setRating(rating))}
              >
                {rating === 0 ? "无星级" : `${rating} 星`}
              </PopupMenuItem>
            ))}
          </PopupMenuSubmenu>
          <PopupMenuSubmenu
            label="设置色标"
            open={submenu === "color"}
            onOpenChange={toggle("color")}
          >
            <PopupMenuItem onSelect={run(() => actions.setColorLabel(null))}>无色标</PopupMenuItem>
            {assetLibraryColorLabels.map((colorLabel) => (
              <PopupMenuItem
                key={colorLabel}
                onSelect={run(() => actions.setColorLabel(colorLabel))}
              >
                {assetLibraryColorLabelNames[colorLabel]}
              </PopupMenuItem>
            ))}
          </PopupMenuSubmenu>
        </>
      )}
      {menu.scope === "content" && (
        <>
          <PopupMenuSeparator />
          <PopupMenuSubmenu label="查看" open={submenu === "view"} onOpenChange={toggle("view")}>
            <AssetLibraryViewPresetItems
              size={model.size}
              onSelect={(size) => run(() => actions.setSize(size))()}
            />
          </PopupMenuSubmenu>
          <PopupMenuSubmenu
            label="排序方式"
            open={submenu === "sort"}
            onOpenChange={toggle("sort")}
          >
            <AssetLibrarySortItems
              sort={model.sort}
              onSelect={(sort) => run(() => actions.setSort(sort))()}
            />
          </PopupMenuSubmenu>
        </>
      )}
      <PopupMenuSeparator />
      {model.hasItems && (
        <PopupMenuItem
          checked={model.itemsHidden}
          onSelect={run(() => actions.setHidden(!model.itemsHidden))}
        >
          隐藏
        </PopupMenuItem>
      )}
      <PopupMenuItem
        checked={model.showHidden}
        onSelect={run(() => actions.setShowHidden(!model.showHidden))}
      >
        查看隐藏内容
      </PopupMenuItem>
      <PopupMenuSeparator />
      <PopupMenuItem shortcut="Alt+Enter" onSelect={run(actions.showProperties)}>
        属性
      </PopupMenuItem>
    </PopupMenu>,
    document.body,
  );
}
