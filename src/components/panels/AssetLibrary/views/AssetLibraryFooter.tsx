import { FolderPlus, Grid2X2, List, Trash2 } from "lucide-react";
import { assetLibraryViewPresets } from "../../../../core/editor/assetLibrary";

export interface AssetLibraryFooterProps {
  size: number;
  listMode: boolean;
  canDelete: boolean;
  onSizeChange: (size: number) => void;
  onCreateFolder: () => void;
  onDelete: () => void;
}

/** As in the Windows status bar, the view buttons switch to the details or large-icon preset. */
function presetSize(id: "details" | "large") {
  return assetLibraryViewPresets.find((preset) => preset.id === id)!.size;
}

/** List and icon view buttons with the size slider, then folder and delete actions. */
export function AssetLibraryFooter({
  size,
  listMode,
  canDelete,
  onSizeChange,
  onCreateFolder,
  onDelete,
}: AssetLibraryFooterProps) {
  return (
    <footer className="media-bin-footer">
      <div className="media-bin-view-tools">
        <button
          type="button"
          className={listMode ? "active" : ""}
          title="列表视图"
          aria-label="列表视图"
          aria-pressed={listMode}
          onClick={() => {
            if (!listMode) onSizeChange(presetSize("details"));
          }}
        >
          <List aria-hidden="true" />
        </button>
        <button
          type="button"
          className={listMode ? "" : "active"}
          title="图标视图"
          aria-label="图标视图"
          aria-pressed={!listMode}
          onClick={() => {
            if (listMode) onSizeChange(presetSize("large"));
          }}
        >
          <Grid2X2 aria-hidden="true" />
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
