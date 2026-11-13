import { FolderPlus, PanelLeft, PanelRight, Trash2 } from "lucide-react";

export interface AssetLibraryFooterProps {
  navigationVisible: boolean;
  detailsVisible: boolean;
  size: number;
  listMode: boolean;
  canDelete: boolean;
  onNavigationVisibleChange: (visible: boolean) => void;
  onDetailsVisibleChange: (visible: boolean) => void;
  onSizeChange: (size: number) => void;
  onCreateFolder: () => void;
  onDelete: () => void;
}

/** Pane toggles and the size slider on the left, folder and delete actions on the right. */
export function AssetLibraryFooter({
  navigationVisible,
  detailsVisible,
  size,
  listMode,
  canDelete,
  onNavigationVisibleChange,
  onDetailsVisibleChange,
  onSizeChange,
  onCreateFolder,
  onDelete,
}: AssetLibraryFooterProps) {
  return (
    <footer className="media-bin-footer">
      <div className="media-bin-view-tools">
        <button
          type="button"
          className={navigationVisible ? "active" : ""}
          title="文件夹窗格"
          aria-label="文件夹窗格"
          aria-pressed={navigationVisible}
          onClick={() => onNavigationVisibleChange(!navigationVisible)}
        >
          <PanelLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className={detailsVisible ? "active" : ""}
          title="属性窗格"
          aria-label="属性窗格"
          aria-pressed={detailsVisible}
          onClick={() => onDetailsVisibleChange(!detailsVisible)}
        >
          <PanelRight aria-hidden="true" />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={size}
          aria-label="显示大小"
          title={listMode ? "显示大小：列表" : "显示大小：图标"}
          onChange={(event) => onSizeChange(Number(event.currentTarget.value))}
        />
      </div>
      <div className="media-bin-action-tools">
        <button
          type="button"
          title="新建文件夹 (Ctrl+Shift+N)"
          aria-label="新建文件夹"
          onClick={onCreateFolder}
        >
          <FolderPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          title="删除 (Delete)"
          aria-label="删除"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
