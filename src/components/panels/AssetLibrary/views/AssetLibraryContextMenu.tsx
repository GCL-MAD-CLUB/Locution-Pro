import { useState } from "react";
import { createPortal } from "react-dom";
import {
  assetLibraryColorLabels,
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
  hasEntries: boolean;
  sort: AssetLibrarySort;
  navigationVisible: boolean;
  detailsVisible: boolean;
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
  setFlag: (flag: AssetLibraryFlag) => void;
  setRating: (rating: number) => void;
  setColorLabel: (colorLabel: AssetLibraryColorLabel | null) => void;
  setSort: (sort: AssetLibrarySort) => void;
  setNavigationVisible: (visible: boolean) => void;
  setDetailsVisible: (visible: boolean) => void;
}

type Submenu = "flag" | "rating" | "color" | "sort" | null;

const sortLabels: Record<AssetLibrarySortKey, string> = {
  name: "名称",
  created: "添加时间",
  start: "入点",
  duration: "时长",
  rating: "星级",
};

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
          <PopupMenuSubmenu
            label="排序方式"
            open={submenu === "sort"}
            onOpenChange={toggle("sort")}
          >
            {(Object.keys(sortLabels) as AssetLibrarySortKey[]).map((key) => (
              <PopupMenuItem
                key={key}
                checked={model.sort.key === key}
                indicator="dot"
                onSelect={run(() => actions.setSort({ ...model.sort, key }))}
              >
                {sortLabels[key]}
              </PopupMenuItem>
            ))}
            <PopupMenuSeparator />
            <PopupMenuItem
              checked={model.sort.direction === "ascending"}
              indicator="dot"
              onSelect={run(() => actions.setSort({ ...model.sort, direction: "ascending" }))}
            >
              递增
            </PopupMenuItem>
            <PopupMenuItem
              checked={model.sort.direction === "descending"}
              indicator="dot"
              onSelect={run(() => actions.setSort({ ...model.sort, direction: "descending" }))}
            >
              递减
            </PopupMenuItem>
          </PopupMenuSubmenu>
          <PopupMenuItem
            checked={model.navigationVisible}
            onSelect={run(() => actions.setNavigationVisible(!model.navigationVisible))}
          >
            导航窗格
          </PopupMenuItem>
          <PopupMenuItem
            checked={model.detailsVisible}
            onSelect={run(() => actions.setDetailsVisible(!model.detailsVisible))}
          >
            属性窗格
          </PopupMenuItem>
        </>
      )}
    </PopupMenu>,
    document.body,
  );
}
