import { Grid2X2, List } from "lucide-react";
import { assetLibraryViewPresets } from "../../../../core/editor/assetLibrary";

export interface AssetLibraryFooterProps {
  size: number;
  listMode: boolean;
  itemCount: number;
  selectedCount: number;
  onSizeChange: (size: number) => void;
}

/** As in the Windows status bar, the view buttons switch to the details or large-icon preset. */
function presetSize(id: "details" | "large") {
  return assetLibraryViewPresets.find((preset) => preset.id === id)!.size;
}

/** List and icon view buttons with the size slider, then the item counts of the status bar. */
export function AssetLibraryFooter({
  size,
  listMode,
  itemCount,
  selectedCount,
  onSizeChange,
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
      <div className="asset-library-status" aria-live="polite">
        {selectedCount > 0 && <span>选中 {selectedCount} 个项目</span>}
        <span>{itemCount} 个项目</span>
      </div>
    </footer>
  );
}
