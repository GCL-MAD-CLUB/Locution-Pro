import { ChevronLeft, ChevronRight, Play, Star, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  assetLibraryColorLabels,
  assetLibraryEntryDurationUs,
  assetLibraryEntryFlag,
  assetLibraryRootLabels,
  trimmedAssetLibraryEntry,
  withAssetLibraryColorLabel,
  withAssetLibraryCustomLabel,
  withAssetLibraryFlag,
  withAssetLibraryKeywords,
  withAssetLibraryRating,
  withAssetLibraryText,
  withAssetLibraryTitle,
  renamedAssetLibraryEntry,
  type AssetLibraryFlag,
} from "../../../../core/editor/assetLibrary";
import { formatDuration, formatMonitorTime, parseMonitorTime } from "../../../../core/editor/time";
import { frameToTimeUs, timeUsToFrame } from "../../../../core/editor/timeline";
import { annotationColors } from "../../../../runtime/theme";
import type { AssetLibraryEntry, AssetLibraryFolder } from "../../../../types";
import type { ResolvedAssetMedia } from "../assetLibraryMedia";
import {
  AssetLibraryFlag as FlagIcon,
  assetLibraryColorLabelNames,
  assetLibraryFlagNames,
} from "./AssetLibraryBadges";
import { AssetLibraryThumbnail } from "./AssetLibraryThumbnail";

export type AssetLibraryEntryRecipe = (entry: AssetLibraryEntry) => AssetLibraryEntry;

interface AssetLibraryDetailsProps {
  folder: { folder: AssetLibraryFolder; childCount: number } | null;
  entries: readonly { entry: AssetLibraryEntry; media: ResolvedAssetMedia | null }[];
  thumbnailsEnabled: boolean;
  onUpdateEntries: (
    label: string,
    ids: readonly string[],
    recipe: AssetLibraryEntryRecipe,
    historyGroupId?: string,
  ) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onPreview: (entry: AssetLibraryEntry) => void;
}

const flagOrder: AssetLibraryFlag[] = ["retained", "none", "excluded"];

function DraftField({
  value,
  label,
  multiline = false,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const shown = draft ?? value;
  const commit = () => {
    if (!cancelledRef.current && draft !== null && draft !== value) onCommit(draft);
    cancelledRef.current = false;
    setDraft(null);
  };
  const cancel = (element: HTMLElement) => {
    cancelledRef.current = true;
    element.blur();
  };
  const shared = {
    className: "asset-library-field",
    value: shown,
    "aria-label": label,
    placeholder,
    onFocus: () => setDraft(value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea
      {...shared}
      rows={4}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel(event.currentTarget);
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.currentTarget.blur();
        }
      }}
    />
  ) : (
    <input
      {...shared}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel(event.currentTarget);
        } else if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function TimecodeField({
  label,
  timeUs,
  frameRate,
  onCommit,
  onNudge,
}: {
  label: string;
  timeUs: number;
  frameRate: number;
  onCommit: (timeUs: number) => void;
  onNudge: (frames: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const formatted = formatMonitorTime(timeUs, frameRate);
  const commit = () => {
    if (!cancelledRef.current && draft !== null) {
      const parsed = parseMonitorTime(draft, frameRate);
      if (parsed !== null && parsed !== timeUs) onCommit(parsed);
    }
    cancelledRef.current = false;
    setDraft(null);
  };
  return (
    <div className="asset-library-timecode">
      <span className="asset-library-detail-label">{label}</span>
      <button type="button" title={`${label}向前 1 帧`} onClick={() => onNudge(-1)}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <input
        className="asset-library-field"
        aria-label={label}
        value={draft ?? formatted}
        onFocus={(event) => {
          setDraft(formatted);
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelledRef.current = true;
            event.currentTarget.blur();
          }
        }}
      />
      <button type="button" title={`${label}向后 1 帧`} onClick={() => onNudge(1)}>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

function KeywordEditor({
  keywords,
  onAdd,
  onRemove,
}: {
  keywords: readonly string[];
  onAdd: (keyword: string) => void;
  onRemove: (keyword: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const keyword = draft.trim();
    if (keyword) onAdd(keyword);
    setDraft("");
  };
  return (
    <div className="asset-library-keywords">
      {keywords.map((keyword) => (
        <span key={keyword} className="asset-library-keyword">
          {keyword}
          <button type="button" title={`移除关键字“${keyword}”`} onClick={() => onRemove(keyword)}>
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        className="asset-library-field asset-library-keyword-input"
        value={draft}
        aria-label="添加关键字"
        placeholder="添加关键字"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Escape") {
            setDraft("");
          }
        }}
      />
    </div>
  );
}

function AnnotationControls({
  entries,
  onUpdate,
}: {
  entries: readonly AssetLibraryEntry[];
  onUpdate: (label: string, recipe: AssetLibraryEntryRecipe) => void;
}) {
  const first = entries[0]!;
  const same = <T,>(read: (entry: AssetLibraryEntry) => T) =>
    entries.every((entry) => read(entry) === read(first)) ? read(first) : undefined;
  const flag = same(assetLibraryEntryFlag);
  const rating = same((entry) => entry.annotation.rating);
  const colorLabel = same((entry) => entry.annotation.color_label);
  const customLabel = same((entry) => entry.annotation.custom_label ?? "");
  const keywords = [...new Set(entries.flatMap((entry) => entry.annotation.keywords))];
  return (
    <>
      <div className="asset-library-detail-row">
        <span className="asset-library-detail-label">旗标</span>
        <div className="asset-library-segmented" role="radiogroup" aria-label="旗标">
          {flagOrder.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={flag === value}
              className={flag === value ? "active" : ""}
              title={assetLibraryFlagNames[value]}
              onClick={() => onUpdate("设置旗标", (entry) => withAssetLibraryFlag(entry, value))}
            >
              <FlagIcon flag={value} />
            </button>
          ))}
        </div>
      </div>
      <div className="asset-library-detail-row">
        <span className="asset-library-detail-label">星级</span>
        <div className="asset-library-stars" role="radiogroup" aria-label="星级">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              className={rating !== undefined && value <= rating ? "active" : ""}
              title={`${value} 星（再次点击清除）`}
              onClick={() =>
                onUpdate("设置星级", (entry) =>
                  withAssetLibraryRating(entry, rating === value ? 0 : value),
                )
              }
            >
              <Star aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="asset-library-detail-row">
        <span className="asset-library-detail-label">色标</span>
        <div className="asset-library-swatches" role="radiogroup" aria-label="色标">
          <button
            type="button"
            role="radio"
            aria-checked={colorLabel === null}
            className={`asset-library-swatch is-none${colorLabel === null ? " active" : ""}`}
            title="无色标"
            onClick={() => onUpdate("设置色标", (entry) => withAssetLibraryColorLabel(entry, null))}
          />
          {assetLibraryColorLabels.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={colorLabel === value}
              className={`asset-library-swatch${colorLabel === value ? " active" : ""}`}
              style={{ background: annotationColors[value] }}
              title={assetLibraryColorLabelNames[value]}
              onClick={() =>
                onUpdate("设置色标", (entry) => withAssetLibraryColorLabel(entry, value))
              }
            />
          ))}
        </div>
      </div>
      <label className="asset-library-detail-field">
        <span className="asset-library-detail-label">标签</span>
        <DraftField
          value={customLabel ?? ""}
          label="自定义标签"
          placeholder={customLabel === undefined ? "多个值" : "无"}
          onCommit={(value) =>
            onUpdate("设置标签", (entry) => withAssetLibraryCustomLabel(entry, value))
          }
        />
      </label>
      <div className="asset-library-detail-field">
        <span className="asset-library-detail-label">关键字</span>
        <KeywordEditor
          keywords={keywords}
          onAdd={(keyword) =>
            onUpdate("添加关键字", (entry) =>
              withAssetLibraryKeywords(entry, [...entry.annotation.keywords, keyword]),
            )
          }
          onRemove={(keyword) =>
            onUpdate("移除关键字", (entry) =>
              withAssetLibraryKeywords(
                entry,
                entry.annotation.keywords.filter((current) => current !== keyword),
              ),
            )
          }
        />
      </div>
    </>
  );
}

function EntryDetails({
  entry,
  media,
  thumbnailsEnabled,
  onUpdateEntries,
  onPreview,
}: {
  entry: AssetLibraryEntry;
  media: ResolvedAssetMedia | null;
  thumbnailsEnabled: boolean;
  onUpdateEntries: AssetLibraryDetailsProps["onUpdateEntries"];
  onPreview: (entry: AssetLibraryEntry) => void;
}) {
  const frameRate = entry.media.frame_rate;
  const update = (label: string, recipe: AssetLibraryEntryRecipe, groupId?: string) =>
    onUpdateEntries(label, [entry.id], recipe, groupId);
  const trim = (startUs: number, endUs: number) =>
    update(
      "调整切点",
      (current) => trimmedAssetLibraryEntry(current, startUs, endUs),
      `asset-library-trim:${entry.id}`,
    );
  const nudged = (timeUs: number, frames: number) =>
    frameToTimeUs(timeUsToFrame(timeUs, frameRate) + frames, frameRate);
  return (
    <>
      <div className="asset-library-details-preview">
        <AssetLibraryThumbnail
          entry={entry}
          media={media}
          displayWidth={320}
          enabled={thumbnailsEnabled}
          priority={1}
        />
        <button
          type="button"
          className="asset-library-preview-button"
          disabled={!media}
          title={media ? "在源监视器中预览" : "媒体离线，无法预览"}
          onClick={() => onPreview(entry)}
        >
          <Play aria-hidden="true" />
        </button>
      </div>
      <label className="asset-library-detail-field">
        <span className="asset-library-detail-label">名称</span>
        <DraftField
          value={entry.name}
          label="名称"
          onCommit={(value) =>
            update("重命名素材", (current) => renamedAssetLibraryEntry(current, value))
          }
        />
      </label>
      <div className="asset-library-detail-row">
        <span className="asset-library-detail-label">来源</span>
        <span className="asset-library-detail-value" title={entry.media.path}>
          {entry.media.file_name}
          {!media && <em className="asset-library-offline-text">（离线）</em>}
        </span>
      </div>
      <TimecodeField
        label="入点"
        timeUs={entry.start_us}
        frameRate={frameRate}
        onCommit={(timeUs) => trim(timeUs, Math.max(entry.end_us, timeUs))}
        onNudge={(frames) => {
          const startUs = nudged(entry.start_us, frames);
          if (startUs < entry.end_us) trim(startUs, entry.end_us);
        }}
      />
      <TimecodeField
        label="出点"
        timeUs={entry.end_us}
        frameRate={frameRate}
        onCommit={(timeUs) => trim(Math.min(entry.start_us, timeUs), timeUs)}
        onNudge={(frames) => {
          const endUs = nudged(entry.end_us, frames);
          if (endUs > entry.start_us) trim(entry.start_us, endUs);
        }}
      />
      <div className="asset-library-detail-row">
        <span className="asset-library-detail-label">时长</span>
        <span className="asset-library-detail-value">
          {formatDuration(assetLibraryEntryDurationUs(entry))}
        </span>
      </div>
      {entry.root === "storyboards" && (
        <label className="asset-library-detail-field">
          <span className="asset-library-detail-label">镜头标题</span>
          <DraftField
            value={entry.annotation.title ?? ""}
            label="镜头标题"
            placeholder="无"
            onCommit={(value) =>
              update("设置镜头标题", (current) => withAssetLibraryTitle(current, value))
            }
          />
        </label>
      )}
      <label className="asset-library-detail-field">
        <span className="asset-library-detail-label">
          {entry.root === "subtitles" ? "字幕文本" : "备注"}
        </span>
        <DraftField
          value={entry.text}
          label={entry.root === "subtitles" ? "字幕文本" : "备注"}
          multiline
          onCommit={(value) =>
            update("编辑素材文本", (current) => withAssetLibraryText(current, value))
          }
        />
      </label>
      <AnnotationControls entries={[entry]} onUpdate={(label, recipe) => update(label, recipe)} />
    </>
  );
}

export function AssetLibraryDetails(props: AssetLibraryDetailsProps) {
  const { folder, entries } = props;
  const single = entries.length === 1 ? entries[0]! : null;
  let content;
  if (single) {
    content = (
      <EntryDetails
        key={single.entry.id}
        entry={single.entry}
        media={single.media}
        thumbnailsEnabled={props.thumbnailsEnabled}
        onUpdateEntries={props.onUpdateEntries}
        onPreview={props.onPreview}
      />
    );
  } else if (entries.length > 1) {
    const ids = entries.map(({ entry }) => entry.id);
    content = (
      <>
        <div className="asset-library-details-heading">已选择 {entries.length} 个素材</div>
        <AnnotationControls
          entries={entries.map(({ entry }) => entry)}
          onUpdate={(label, recipe) => props.onUpdateEntries(label, ids, recipe)}
        />
      </>
    );
  } else if (folder) {
    content = (
      <>
        <label className="asset-library-detail-field">
          <span className="asset-library-detail-label">名称</span>
          <DraftField
            key={folder.folder.id}
            value={folder.folder.name}
            label="文件夹名称"
            onCommit={(value) => props.onRenameFolder(folder.folder.id, value)}
          />
        </label>
        <div className="asset-library-detail-row">
          <span className="asset-library-detail-label">位置</span>
          <span className="asset-library-detail-value">
            {assetLibraryRootLabels[folder.folder.root]}
          </span>
        </div>
        <div className="asset-library-detail-row">
          <span className="asset-library-detail-label">内容</span>
          <span className="asset-library-detail-value">{folder.childCount} 项</span>
        </div>
        <div className="asset-library-detail-row">
          <span className="asset-library-detail-label">创建时间</span>
          <span className="asset-library-detail-value">
            {new Date(folder.folder.created_at).toLocaleString("zh-CN")}
          </span>
        </div>
      </>
    );
  } else {
    content = <div className="asset-library-empty">选择素材以查看和编辑属性</div>;
  }
  return (
    <aside className="asset-library-details" aria-label="素材属性">
      {content}
    </aside>
  );
}
