import { Captions, ChevronDown, ChevronRight, Film } from "lucide-react";
import type { DragEvent, MouseEvent as ReactMouseEvent, ReactElement } from "react";
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
import { assetLocationKey } from "../assetLibraryNodes";
import { AssetLibraryFolderIcon } from "./AssetLibraryBadges";

interface AssetLibraryNavigationProps {
  library: ProjectAssetLibraryState;
  location: AssetLibraryLocation;
  collapsedKeys: ReadonlySet<string>;
  dropTargetKey: string | null;
  onNavigate: (location: AssetLibraryLocation) => void;
  onToggleCollapsed: (key: string) => void;
  onDragOverTarget: (event: DragEvent<HTMLElement>, location: AssetLibraryLocation) => void;
  onDragLeaveTarget: () => void;
  onDropOnTarget: (event: DragEvent<HTMLElement>, location: AssetLibraryLocation) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, location: AssetLibraryLocation) => void;
}

const rootIcons: Record<AssetLibraryRoot, typeof Captions> = {
  subtitles: Captions,
  storyboards: Film,
};

export function AssetLibraryNavigation(props: AssetLibraryNavigationProps) {
  const { library, location, collapsedKeys, dropTargetKey } = props;
  const childrenByParent = new Map<string, AssetLibraryFolder[]>();
  for (const folder of library.folders) {
    const key = folder.parent_id ?? `root:${folder.root}`;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), folder]);
  }
  const sortedChildren = (key: string) =>
    sortedAssetLibraryNodes(childrenByParent.get(key) ?? [], [], {
      key: "name",
      direction: "ascending",
    }).folders;

  function renderItem(
    target: AssetLibraryLocation,
    label: string,
    icon: ReactElement,
    depth: number,
  ): ReactElement {
    const key = assetLocationKey(target);
    const children = sortedChildren(key);
    const collapsed = collapsedKeys.has(key);
    const active = assetLocationKey(location) === key;
    return (
      <li key={key} role="treeitem" aria-expanded={children.length ? !collapsed : undefined}>
        <div
          className={`asset-library-tree-item${active ? " active" : ""}${
            dropTargetKey === key ? " drop-target" : ""
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          aria-selected={active}
          onClick={() => props.onNavigate(target)}
          onContextMenu={(event) => props.onContextMenu(event, target)}
          onDragOver={(event) => props.onDragOverTarget(event, target)}
          onDragLeave={props.onDragLeaveTarget}
          onDrop={(event) => props.onDropOnTarget(event, target)}
        >
          <button
            type="button"
            className="asset-library-tree-toggle"
            tabIndex={-1}
            aria-label={collapsed ? "展开" : "折叠"}
            disabled={children.length === 0}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleCollapsed(key);
            }}
          >
            {children.length > 0 &&
              (collapsed ? (
                <ChevronRight aria-hidden="true" />
              ) : (
                <ChevronDown aria-hidden="true" />
              ))}
          </button>
          {icon}
          <span className="asset-library-tree-label" title={label}>
            {label}
          </span>
        </div>
        {children.length > 0 && !collapsed && (
          <ul role="group">
            {children.map((folder) =>
              renderItem(
                { root: folder.root, folderId: folder.id },
                folder.name,
                <AssetLibraryFolderIcon className="asset-library-tree-icon" />,
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
      <ul role="tree">
        {assetLibraryRoots.map((root) => {
          const Icon = rootIcons[root];
          return renderItem(
            { root, folderId: null },
            assetLibraryRootLabels[root],
            <Icon className="asset-library-tree-icon is-root" aria-hidden="true" />,
            0,
          );
        })}
      </ul>
    </nav>
  );
}
