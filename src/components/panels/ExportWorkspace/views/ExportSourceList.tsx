import {} from "react";
import { formatDuration } from "../../../../core/editor/playback/time";
import type { ExportClip, ExportSource } from "../../../../systems/ExportSystem";
import { ExportClipThumbnail } from "./ExportClipThumbnail";
import "./ExportSourceList.css";

interface ExportSourceListProps {
  source: ExportSource;
  selectedClipIds: Set<string>;
  previewClipId: string | null;
  onToggleClip: (clipId: string) => void;
  onSetAllSelected: (selected: boolean) => void;
  onPreviewClip: (clipId: string, play?: boolean) => void;
}

function clipDurationUs(clip: ExportClip) {
  if (clip.endUs > 0) {
    return Math.max(0, clip.endUs - clip.startUs);
  }
  return Math.max(0, clip.durationUs);
}

/** The first label line leads; any further lines (a translation, keywords) follow quieter. */
function clipLabelLines(label: string) {
  const [primary = "", ...rest] = label.split("\n").filter((line) => line.trim() !== "");
  return { primary, secondary: rest.join(" ") };
}

function SelectAllCheckbox({
  checked,
  mixed,
  onChange,
}: {
  checked: boolean;
  mixed: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      ref={(input) => {
        if (input) input.indeterminate = mixed;
      }}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function ExportSourceList({
  source,
  selectedClipIds,
  previewClipId,
  onToggleClip,
  onSetAllSelected,
  onPreviewClip,
}: ExportSourceListProps) {
  const selectedClips = source.clips.filter((clip) => selectedClipIds.has(clip.id));
  const allSelected = source.clips.length > 0 && selectedClips.length === source.clips.length;
  const totalDurationUs = selectedClips.reduce((sum, clip) => sum + clipDurationUs(clip), 0);

  return (
    <section className="export-clips-panel">
      <div className="export-source-toolbar">
        <label className="export-check-label">
          <SelectAllCheckbox
            checked={allSelected}
            mixed={!allSelected && selectedClips.length > 0}
            onChange={onSetAllSelected}
          />
          <span>全选</span>
        </label>
        <span className="export-source-summary">
          已选 <strong>{selectedClips.length}</strong> / {source.clips.length}
        </span>
        <span className="export-source-duration">
          总时长 <strong>{formatDuration(totalDurationUs)}</strong>
        </span>
      </div>

      <div className="export-clip-list">
        {source.clips.map((clip) => {
          const selected = selectedClipIds.has(clip.id);
          const previewing = previewClipId === clip.id;
          const { primary, secondary } = clipLabelLines(clip.label);
          return (
            <div
              key={clip.id}
              className={`export-clip-row ${selected ? "is-selected" : ""} ${
                previewing ? "is-previewing" : ""
              }`}
              title={clip.sourcePath}
              onClick={() => onPreviewClip(clip.id)}
            >
              <span
                className="export-clip-checkbox-cell"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  aria-label={`导出 ${primary}`}
                  onChange={() => onToggleClip(clip.id)}
                />
              </span>
              <ExportClipThumbnail
                clip={clip}
                durationText={formatDuration(clipDurationUs(clip))}
                onPlay={() => onPreviewClip(clip.id, true)}
              />
              <span className="export-clip-info">
                <span className="export-clip-label">{primary}</span>
                {secondary ? (
                  <span className="export-clip-label-secondary">{secondary}</span>
                ) : null}
                <span className="export-clip-meta">
                  <span>{formatDuration(clip.startUs)}</span>
                  {clip.endUs > 0 ? (
                    <>
                      <span className="export-clip-meta-separator" aria-hidden="true" />
                      <span>{formatDuration(clip.endUs)}</span>
                    </>
                  ) : null}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
