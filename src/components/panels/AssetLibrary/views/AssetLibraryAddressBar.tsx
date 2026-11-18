import { useScopedState } from "../../../../runtime/state/useScopedState";
import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Search } from "lucide-react";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  assetLibraryLocationExists,
  assetLibraryProjectLabel,
  assetLibraryProjectPlace,
  assetLibraryRootLabels,
  assetLibraryRoots,
  isAssetLibraryHomePlace,
  isAssetLibraryLocation,
  sameAssetLibraryLocation,
  sortedAssetLibraryNodes,
  type AssetLibraryLocation,
  type AssetLibraryPlace,
} from "../../../../core/editor/assetLibrary";
import {
  assetLibraryPlaceFromPath,
  assetLibraryPlacePathText,
} from "../../../../core/editor/assetLibraryPlace";
import { assetLibraryHomeLabel } from "../../../../core/editor/assetLibraryHome";
import type { AssetLibraryFolder, ProjectAssetLibraryState } from "../../../../types";
import { PopupMenu, PopupMenuItem, useCloseOnOutsidePointer } from "../../../common/PopupMenu";
import { assetLibraryDropTargetProps } from "../../../common/utils/assetLibraryDropTarget";
import { assetLocationKey } from "../model/nodes";
import {
  AssetLibraryHomeIcon,
  AssetLibraryProjectIcon,
  assetLibraryRootIcons,
} from "./AssetLibraryIcons";

type AddressMenu =
  | { kind: "roots"; x: number; y: number }
  | { kind: "children"; location: AssetLibraryLocation; x: number; y: number }
  | { kind: "back" | "forward"; x: number; y: number };

export interface AssetLibraryAddressBarProps {
  library: ProjectAssetLibraryState;
  location: AssetLibraryPlace;
  path: readonly AssetLibraryFolder[];
  backStack: readonly AssetLibraryPlace[];
  forwardStack: readonly AssetLibraryPlace[];
  editing: boolean;
  dropTargetKey: string | null;
  onEditingChange: (editing: boolean) => void;
  onNavigate: (location: AssetLibraryPlace) => void;
  onGoBack: (steps: number) => void;
  onGoForward: (steps: number) => void;
  onNavigateUp: () => void;
  onInvalidPath: (text: string) => void;
  /** The search field ends the row, as in a file manager. */
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
}

/** Drop-target keys for crumbs, kept apart from tree and item keys. */
export function assetLibraryCrumbDropKey(location: AssetLibraryPlace) {
  return `crumb:${assetLocationKey(location)}`;
}

function AddressInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (value: string) => boolean;
  onCancel: () => void;
}) {
  const [value, setValue] = useScopedState(null, initialValue);
  return (
    <input
      className="asset-library-address-input"
      value={value}
      aria-label="地址"
      autoFocus
      spellCheck={false}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={onCancel}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (!onSubmit(value)) event.currentTarget.select();
        }
      }}
    />
  );
}

export function AssetLibraryAddressBar(props: AssetLibraryAddressBarProps) {
  const lifetime = new RenderLifetime();

  const { library, location, path, backStack, forwardStack, dropTargetKey, searchRef, query } =
    props;
  const [menu, setMenu] = useState<AddressMenu | null>(null);
  useCloseOnOutsidePointer(lifetime, Boolean(menu), () => setMenu(null), {
    capturePointerdown: true,
    ignorePopupMenuTargets: true,
  });
  // The home and the project are tops of their own; neither is inside a library.
  const home = isAssetLibraryHomePlace(location);
  const libraryPlace = isAssetLibraryLocation(location) ? location : null;
  const project = !libraryPlace;
  const RootIcon = home
    ? AssetLibraryHomeIcon
    : libraryPlace
      ? assetLibraryRootIcons[libraryPlace.root]
      : AssetLibraryProjectIcon;
  const pathIds = new Set(path.map((folder) => folder.id));
  const placeLabel =
    path.at(-1)?.name ??
    (home
      ? assetLibraryHomeLabel
      : libraryPlace
        ? assetLibraryRootLabels[libraryPlace.root]
        : assetLibraryProjectLabel);

  function childFolders(parent: AssetLibraryLocation) {
    return sortedAssetLibraryNodes(
      library.folders.filter(
        (folder) => folder.root === parent.root && folder.parent_id === parent.folderId,
      ),
      [],
      { key: "name", direction: "ascending" },
    ).folders;
  }

  function openMenuBelow(event: ReactMouseEvent<HTMLElement>, next: AddressMenu) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({ ...next, x: bounds.left, y: bounds.bottom });
  }

  function choose(action: () => void) {
    return () => {
      setMenu(null);
      action();
    };
  }

  function chevron(label: string, next: AddressMenu, open: boolean) {
    return (
      <button
        type="button"
        className={`asset-library-breadcrumb-chevron${open ? " is-open" : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => openMenuBelow(event, next)}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    );
  }

  function crumb(target: AssetLibraryPlace, label: string, current: boolean) {
    const dropKey = assetLibraryCrumbDropKey(target);
    // The project and the home hold no items, so their crumbs take no drops.
    const dropTarget = isAssetLibraryLocation(target) ? target : null;
    return (
      <button
        type="button"
        className={`${current ? "is-current" : ""}${dropTargetKey === dropKey ? " is-drop-target" : ""}`}
        title={label}
        onClick={() => props.onNavigate(target)}
        {...(dropTarget ? assetLibraryDropTargetProps(dropTarget, dropKey) : {})}
      >
        {label}
      </button>
    );
  }

  function isChildMenu(parent: AssetLibraryLocation) {
    return menu?.kind === "children" && sameAssetLibraryLocation(menu.location, parent);
  }

  function historyItem(target: AssetLibraryPlace, index: number, onSelect: () => void) {
    const exists = !isAssetLibraryLocation(target) || assetLibraryLocationExists(library, target);
    return (
      <PopupMenuItem
        key={`${index}:${assetLocationKey(target)}`}
        disabled={!exists}
        onSelect={choose(onSelect)}
      >
        {assetLibraryPlacePathText(library, target)}
      </PopupMenuItem>
    );
  }

  function renderMenu() {
    if (!menu) return null;
    let items;
    if (menu.kind === "roots") {
      items = assetLibraryRoots.map((root) => (
        <PopupMenuItem
          key={root}
          checked={location.root === root}
          indicator="dot"
          onSelect={choose(() => props.onNavigate({ root, folderId: null }))}
        >
          {assetLibraryRootLabels[root]}
        </PopupMenuItem>
      ));
    } else if (menu.kind === "children") {
      const children = childFolders(menu.location);
      items = children.length ? (
        children.map((folder) => (
          <PopupMenuItem
            key={folder.id}
            checked={pathIds.has(folder.id)}
            indicator="dot"
            onSelect={choose(() => props.onNavigate({ root: folder.root, folderId: folder.id }))}
          >
            {folder.name}
          </PopupMenuItem>
        ))
      ) : (
        <PopupMenuItem disabled>没有子文件夹</PopupMenuItem>
      );
    } else if (menu.kind === "back") {
      items = [...backStack]
        .reverse()
        .map((target, index) => historyItem(target, index, () => props.onGoBack(index + 1)));
    } else {
      items = forwardStack.map((target, index) =>
        historyItem(target, index, () => props.onGoForward(index + 1)),
      );
    }
    return createPortal(
      <PopupMenu
        className="asset-library-context-menu"
        contextMenuAnchor={menu}
        ariaLabel={menu.kind === "back" || menu.kind === "forward" ? "最近位置" : "文件夹"}
        style={{ position: "fixed", left: menu.x, top: menu.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items}
      </PopupMenu>,
      document.body,
    );
  }

  function submitPath(text: string) {
    const target = assetLibraryPlaceFromPath(library, text, location);
    if (!target) {
      props.onInvalidPath(text.trim());
      return false;
    }
    props.onEditingChange(false);
    props.onNavigate(target);
    return true;
  }

  const hasChildren = libraryPlace !== null && childFolders(libraryPlace).length > 0;

  return lifetime.render(
    <div className="asset-library-location-row">
      <div className="asset-library-history" aria-label="位置历史">
        <button
          type="button"
          title="后退 (Alt+←)，右键显示最近位置"
          aria-label="后退"
          disabled={backStack.length === 0}
          onClick={() => props.onGoBack(1)}
          onContextMenu={(event) => openMenuBelow(event, { kind: "back", x: 0, y: 0 })}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          title="前进 (Alt+→)，右键显示最近位置"
          aria-label="前进"
          disabled={forwardStack.length === 0}
          onClick={() => props.onGoForward(1)}
          onContextMenu={(event) => openMenuBelow(event, { kind: "forward", x: 0, y: 0 })}
        >
          <ArrowRight aria-hidden="true" />
        </button>
        <button
          type="button"
          title="上一级 (Alt+↑)"
          aria-label="上一级"
          disabled={project}
          onClick={props.onNavigateUp}
        >
          <ArrowUp aria-hidden="true" />
        </button>
      </div>
      <div className="asset-library-address">
        <span className="media-bin-kind-icon folder">
          <RootIcon />
        </span>
        {props.editing ? (
          <AddressInput
            initialValue={assetLibraryPlacePathText(library, location)}
            onSubmit={submitPath}
            onCancel={() => props.onEditingChange(false)}
          />
        ) : (
          <nav
            className="asset-library-breadcrumb"
            aria-label="当前位置"
            title="单击空白处输入路径"
            onClick={(event) => {
              if (event.target === event.currentTarget) props.onEditingChange(true);
            }}
          >
            {home && crumb(location, assetLibraryHomeLabel, true)}
            {!home && crumb(assetLibraryProjectPlace, assetLibraryProjectLabel, project)}
            {!home && chevron("切换素材库", { kind: "roots", x: 0, y: 0 }, menu?.kind === "roots")}
            {libraryPlace &&
              crumb(
                { root: libraryPlace.root, folderId: null },
                assetLibraryRootLabels[libraryPlace.root],
                path.length === 0,
              )}
            {path.map((folder, index) => {
              const parent: AssetLibraryLocation = {
                root: folder.root,
                folderId: folder.parent_id,
              };
              return (
                <span key={folder.id} className="asset-library-breadcrumb-part">
                  {chevron(
                    "显示子文件夹",
                    { kind: "children", location: parent, x: 0, y: 0 },
                    isChildMenu(parent),
                  )}
                  {crumb(
                    { root: folder.root, folderId: folder.id },
                    folder.name,
                    index === path.length - 1,
                  )}
                </span>
              );
            })}
            {hasChildren &&
              libraryPlace &&
              chevron(
                "显示子文件夹",
                { kind: "children", location: libraryPlace, x: 0, y: 0 },
                isChildMenu(libraryPlace),
              )}
          </nav>
        )}
      </div>
      <label className="media-bin-search asset-library-search">
        <Search aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          placeholder={`在“${placeLabel}”中搜索`}
          aria-label="搜索素材"
          onChange={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onQueryChange("");
          }}
        />
      </label>
      {renderMenu()}
    </div>,
  );
}
