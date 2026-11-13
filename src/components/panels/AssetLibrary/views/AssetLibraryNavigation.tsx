import { Captions, ChevronRight, Film, FolderPlus } from "lucide-react";
import type { CSSProperties, DragEvent, MouseEvent as ReactMouseEvent, ReactElement } from "react";
import {
  assetLibraryRootLabels,
  assetLibraryRoots,
  sortedAssetLibraryNodes,
  type AssetLibraryLocation,
} from "../../../../core/editor/assetLibrary";
import type {
  AssetLibraryFolder,
  AssetLibraryRoot,
  ProjectAssetLibraryState,
} from "../../../../types";
import { MediaBinFolderIcon } from "../../MediaBin/views/MediaBinFolderIcon";
import { assetLocationKey } from "../assetLibraryNodes";

interface AssetLibraryNavigationProps {
  library: ProjectAssetLibraryState;
  location: AssetLibraryLocation;
  collapsedKeys: ReadonlySet<string>;
  dropTargetKey: string | null;
  onNavigate: (location: AssetLibraryLocation) => void;
  onToggleCollapsed: (key: string) => void;
  onCreateFolder: () => void;
  onDragOverTarget: (event: DragEvent<HTMLElement>, location: AssetLibraryLocation) => void;
  onDragLeaveTarget: () => void;
  onDropOnTarget: (event: DragEvent<HTMLElement>, location: AssetLibraryLocation) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, location: AssetLibraryLocation) => void;
}

const rootIcons: Record<AssetLibraryRoot, { className: string; Icon: typeof Captions }> = {
  subtitles: { className: "subtitle", Icon: Captions },
  storyboards: { className: "video", Icon: Film },
};

function parentKey(root: AssetLibraryRoot, folderId: string | null) {
  return assetLocationKey({ root, folderId });
}

export function AssetLibraryNavigation(props: AssetLibraryNavigationProps) {
  const { library, location, collapsedKeys, dropTargetKey } = props;
  // Both maps use location keys so lookups match at every depth, not just under the roots.
  const childrenByParent = new Map<string, AssetLibraryFolder[]>();
  const countByParent = new Map<string, number>();
  for (const folder of library.folders) {
    const key = parentKey(folder.root, folder.parent_id);
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), folder]);
    countByParent.set(key, (countByParent.get(key) ?? 0) + 1);
  }
  for (const entry of library.entries) {
    const key = parentKey(entry.root, entry.folder_id);
    countByParent.set(key, (countByParent.get(key) ?? 0) + 1);
  }
  const sortedChildren = (key: string) =>
    sortedAssetLibraryNodes(childrenByParent.get(key) ?? [], [], {
      key: "name",
      direction: "ascending",
    }).folders;
  const activeKey = assetLocationKey(location);

  function renderItem(
    target: AssetLibraryLocation,
    label: string,
    icon: ReactElement,
    depth: number,
  ): ReactElement {
    const key = assetLocationKey(target);
    const children = sortedChildren(key);
    const expandable = children.length > 0;
    const expanded = expandable && !collapsedKeys.has(key);
    const active = activeKey === key;
    return (
      <li
        key={key}
        role="treeitem"
        aria-selected={active}
        aria-expanded={expandable ? expanded : undefined}
      >
        <div
          className={`media-bin-row media-bin-folder-row asset-library-tree-row${
            active ? " selected" : ""
          }${dropTargetKey === key ? " folder-drop-target" : ""}`}
          style={{ "--asset-tree-depth": depth } as CSSProperties}
          onClick={() => props.onNavigate(target)}
          onDoubleClick={() => expandable && props.onToggleCollapsed(key)}
          onContextMenu={(event) => props.onContextMenu(event, target)}
          onDragOver={(event) => props.onDragOverTarget(event, target)}
          onDragLeave={props.onDragLeaveTarget}
          onDrop={(event) => props.onDropOnTarget(event, target)}
        >
          <span className="media-bin-title-cell media-bin-folder-title-cell">
            {expandable ? (
              <button
                type="button"
                className={`media-bin-folder-toggle asset-library-tree-toggle${
                  expanded ? " expanded" : ""
                }`}
                tabIndex={-1}
                aria-label={expanded ? `折叠${label}` : `展开${label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleCollapsed(key);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            ) : (
              <span className="asset-library-tree-toggle" aria-hidden="true" />
            )}
            {icon}
            <span className="media-bin-name-copy" title={label}>
              {label}
            </span>
          </span>
          <span className="asset-library-tree-count">{countByParent.get(key) ?? 0}</span>
        </div>
        {expanded && (
          <ul role="group">
            {children.map((folder) =>
              renderItem(
                { root: folder.root, folderId: folder.id },
                folder.name,
                <span className="media-bin-kind-icon folder">
                  <MediaBinFolderIcon />
                </span>,
                depth + 1,
              ),
            )}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav className="asset-library-navigation" aria-label="素材库文件夹">
      <div className="media-bin-table-header-viewport">
        <div className="media-bin-table-header asset-library-tree-header" role="presentation">
          <span className="media-bin-column-header">
            <span className="media-bin-column-label-text">文件夹</span>
          </span>
          <button
            type="button"
            className="asset-library-tree-action"
            title="新建文件夹 (Ctrl+Shift+N)"
            aria-label="新建文件夹"
            onClick={props.onCreateFolder}
          >
            <FolderPlus aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="media-bin-table-scroll">
        <ul className="asset-library-tree" role="tree">
          {assetLibraryRoots.map((root) => {
            const { className, Icon } = rootIcons[root];
            return renderItem(
              { root, folderId: null },
              assetLibraryRootLabels[root],
              <span className={`media-bin-kind-icon ${className}`}>
                <Icon aria-hidden="true" />
              </span>,
              0,
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
