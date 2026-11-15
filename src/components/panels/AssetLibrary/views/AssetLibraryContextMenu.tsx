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
import {
  assetLibraryGroupingFor,
  assetLibraryGroupKeyLabels,
  assetLibraryGroupKeys,
  type AssetLibraryGrouping,
} from "../../../../core/editor/assetLibraryGroup";
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
  /** At the home, a single item can open the folder that holds it. */
  canOpenLocation: boolean;
  /** Folders pin to quick access; null when the menu acts on anything else. */
  pin: "pin" | "unpin" | null;
  /** Materials are added to favorites; null when the menu acts on anything else. */
  favorite: "add" | "remove" | null;
  canRemoveRecent: boolean;
  canCreateFolder: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canDuplicate: boolean;
  canRename: boolean;
  canDelete: boolean;
  /** Whether the items hold materials whose media can export. */
  canExport: boolean;
  hasLastExportSettings: boolean;
  canSelectAll: boolean;
  hasEntries: boolean;
  /** Whether the menu acts on items; a menu on blank space or a library root does not. */
  hasItems: boolean;
  /** Every item the menu acts on is hidden, so "隐藏" shows checked and unhides them. */
  itemsHidden: boolean;
  showHidden: boolean;
  sort: AssetLibrarySort;
  group: AssetLibraryGrouping;
  size: number;
}

export interface AssetLibraryContextMenuActions {
  open: () => void;
  openLocation: () => void;
  setPinned: (pinned: boolean) => void;
  setFavorite: (favorite: boolean) => void;
  removeRecent: () => void;
  createFolder: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  rename: () => void;
  remove: () => void;
  exportItems: () => void;
  quickExport: () => void;
  selectAll: () => void;
  showProperties: () => void;
  setFlag: (flag: AssetLibraryFlag) => void;
  setRating: (rating: number) => void;
  setColorLabel: (colorLabel: AssetLibraryColorLabel | null) => void;
  setSort: (sort: AssetLibrarySort) => void;
  setGroup: (group: AssetLibraryGrouping) => void;
  setSize: (size: number) => void;
  setHidden: (hidden: boolean) => void;
  setShowHidden: (visible: boolean) => void;
}

type Submenu = "export" | "flag" | "rating" | "color" | "sort" | "group" | "view" | null;

/** The menu's sort keys; the other columns sort from their headers. */
const sortLabels: Partial<Record<AssetLibrarySortKey, string>> = {
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

/** Group keys, or none, then the order of the groups, as in a file manager. */
export function AssetLibraryGroupItems({
  group,
  onSelect,
}: {
  group: AssetLibraryGrouping;
  onSelect: (group: AssetLibraryGrouping) => void;
}) {
  return (
    <>
      {[...assetLibraryGroupKeys, null].map((key) => (
        <PopupMenuItem
          key={key ?? "none"}
          checked={group.key === key}
          indicator="dot"
          onSelect={() => onSelect(assetLibraryGroupingFor(key))}
        >
          {key ? assetLibraryGroupKeyLabels[key] : "(无)"}
        </PopupMenuItem>
      ))}
      {group.key && (
        <>
          <PopupMenuSeparator />
          {(["ascending", "descending"] as const).map((direction) => (
            <PopupMenuItem
              key={direction}
              checked={group.direction === direction}
              indicator="dot"
              onSelect={() => onSelect({ ...group, direction })}
            >
              {direction === "ascending" ? "递增" : "递减"}
            </PopupMenuItem>
          ))}
        </>
      )}
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
        <PopupMenuItem shortcut="Enter" onSelect={run(actions.open)}>
          {model.openLabel}
        </PopupMenuItem>
      )}
      {model.canOpenLocation && (
        <PopupMenuItem onSelect={run(actions.openLocation)}>打开所在位置</PopupMenuItem>
      )}
      {model.pin && (
        <PopupMenuItem onSelect={run(() => actions.setPinned(model.pin === "pin"))}>
          {model.pin === "pin" ? "固定到快速访问" : "从快速访问取消固定"}
        </PopupMenuItem>
      )}
      {model.favorite && (
        <PopupMenuItem onSelect={run(() => actions.setFavorite(model.favorite === "add"))}>
          {model.favorite === "add" ? "添加到收藏夹" : "从收藏夹中删除"}
        </PopupMenuItem>
      )}
      {model.canRemoveRecent && (
        <PopupMenuItem onSelect={run(actions.removeRecent)}>从最近使用中删除</PopupMenuItem>
      )}
      {(model.canOpen ||
        model.canOpenLocation ||
        model.pin ||
        model.favorite ||
        model.canRemoveRecent) && <PopupMenuSeparator />}
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
      <PopupMenuSeparator />
      <PopupMenuSubmenu
        label="导出"
        open={submenu === "export"}
        disabled={!model.canExport}
        enableMnemonics
        onOpenChange={toggle("export")}
      >
        <PopupMenuItem mnemonic="E" onSelect={run(actions.exportItems)}>
          导出(E)...
        </PopupMenuItem>
        <PopupMenuItem
          mnemonic="W"
          disabled={!model.hasLastExportSettings}
          onSelect={run(actions.quickExport)}
        >
          使用上次设置导出(W)
        </PopupMenuItem>
      </PopupMenuSubmenu>
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
          <PopupMenuSubmenu
            label="分组依据"
            open={submenu === "group"}
            onOpenChange={toggle("group")}
          >
            <AssetLibraryGroupItems
              group={model.group}
              onSelect={(group) => run(() => actions.setGroup(group))()}
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
