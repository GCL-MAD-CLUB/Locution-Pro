import { ChevronLeft, ChevronRight, Play, Star } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  assetLibraryColorLabels,
  assetLibraryEntryDurationUs,
  assetLibraryEntryFlag,
  assetLibraryRootLabels,
  renamedAssetLibraryEntry,
  trimmedAssetLibraryEntry,
  withAssetLibraryColorLabel,
  withAssetLibraryCustomLabel,
  withAssetLibraryFlag,
  withAssetLibraryKeywords,
  withAssetLibraryRating,
  withAssetLibraryText,
  withAssetLibraryTitle,
  type AssetLibraryFlag,
} from "../../../../core/editor/assetLibrary";
import { formatMonitorTime, parseMonitorTime } from "../../../../core/editor/time";
import { frameToTimeUs, timeUsToFrame } from "../../../../core/editor/timeline";
import type {
  AssetLibraryColorLabel,
  AssetLibraryEntry,
  AssetLibraryFolder,
} from "../../../../types";
import { StoryboardColorLabelButtons } from "../../StoryboardPanel/annotations/StoryboardColorLabelButtons";
import { StoryboardFlagIcon } from "../../StoryboardPanel/annotations/StoryboardFlagIcon";
import "../../StoryboardPanel/StoryboardPanel.css";
import {
  StoryboardSidebarHeading,
  StoryboardSidebarSection,
} from "../../StoryboardPanel/StoryboardSidebarSection";
import type { ResolvedAssetMedia } from "../assetLibraryMedia";
import { assetLibraryColorLabelNames, assetLibraryFlagNames } from "./AssetLibraryBadges";
import { AssetLibraryThumbnail } from "./AssetLibraryThumbnail";

export type AssetLibraryEntryRecipe = (entry: AssetLibraryEntry) => AssetLibraryEntry;

interface AssetLibraryDetailsProps {
  folder: { folder: AssetLibraryFolder; childCount: number } | null;
  entries: readonly { entry: AssetLibraryEntry; media: ResolvedAssetMedia | null }[];
  thumbnailsEnabled: boolean;
  collapsedSections: ReadonlySet<string>;
  onToggleSection: (section: string) => void;
  onUpdateEntries: (
    label: string,
    ids: readonly string[],
    recipe: AssetLibraryEntryRecipe,
    historyGroupId?: string,
  ) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onPreview: (entry: AssetLibraryEntry) => void;
}

interface SectionState {
  collapsed: ReadonlySet<string>;
  onToggle: (section: string) => void;
}

const flagOrder: AssetLibraryFlag[] = ["retained", "none", "excluded"];
/** Marks keywords that only some of the selected entries carry, as in the storyboard panel. */
const partialKeywordMark = "*";
/** Collapses every section at once, like the storyboard keyword panel heading. */
const panelSection = "panel";

function isAssetColorLabel(value: string): value is AssetLibraryColorLabel {
  return (assetLibraryColorLabels as readonly string[]).includes(value);
}

function Section({
  id,
  title,
  state,
  children,
}: {
  id: string;
  title: string;
  state: SectionState;
  children: ReactNode;
}) {
  return (
    <StoryboardSidebarSection
      title={title}
      className="storyboard-keyword-assignment"
      open={!state.collapsed.has(id)}
      onToggle={() => state.onToggle(id)}
    >
      {children}
    </StoryboardSidebarSection>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="asset-library-field">
      <span className="asset-library-field-label">{label}</span>
      <div className="asset-library-field-control">{children}</div>
    </div>
  );
}

function ReadOnlyValue({ value, title }: { value: ReactNode; title?: string }) {
  return (
    <span className="asset-library-field-value" title={title}>
      {value}
    </span>
  );
}

/** A storyboard-style inline entry that commits on Enter or blur and reverts on Escape. */
function InlineInput({
  value,
  label,
  placeholder,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const commit = () => {
    if (!cancelledRef.current && draft !== null && draft !== value) onCommit(draft);
    cancelledRef.current = false;
    setDraft(null);
  };
  return (
    <div className="storyboard-keyword-inline-entry">
      <input
        value={draft ?? value}
        aria-label={label}
        placeholder={placeholder}
        onFocus={() => setDraft(value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            cancelledRef.current = true;
            event.currentTarget.blur();
          } else if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/**
 * The storyboard keyword editor box: shows the value as text and swaps in a textarea while
 * editing. `submitOnEnter` matches the keyword editor; text fields take Ctrl+Enter instead.
 */
function PlainEditor({
  value,
  label,
  placeholder,
  submitOnEnter,
  title,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder: string;
  submitOnEnter: boolean;
  title?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editing = draft !== null;
  useLayoutEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);
  const finish = () => {
    if (!cancelledRef.current && draft !== null && draft !== value) onCommit(draft);
    cancelledRef.current = false;
    setDraft(null);
  };
  return (
    <div className="storyboard-keyword-plain-editor" title={title}>
      {!editing && (
        <div
          className={`storyboard-keyword-plain-editor-display${
            value ? "" : " asset-library-plain-placeholder"
          }`}
          onClick={() => setDraft(value)}
        >
          {value || placeholder}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={editing ? "" : "is-hidden"}
        value={draft ?? value}
        aria-label={label}
        onFocus={() => setDraft((current) => current ?? value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          event.stopPropagation();
          const submit = submitOnEnter
            ? event.key === "Enter"
            : event.key === "Enter" && (event.ctrlKey || event.metaKey);
          if (submit) {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function TimecodeControl({
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
  const [invalid, setInvalid] = useState(false);
  const cancelledRef = useRef(false);
  const formatted = formatMonitorTime(timeUs, frameRate);
  const commit = () => {
    if (!cancelledRef.current && draft !== null) {
      const parsed = parseMonitorTime(draft, frameRate);
      if (parsed !== null && parsed !== timeUs) onCommit(parsed);
    }
    cancelledRef.current = false;
    setDraft(null);
    setInvalid(false);
  };
  return (
    <div className="storyboard-filter-edits asset-library-timecode">
      <button
        type="button"
        title={`${label}后退 1 帧`}
        aria-label={`${label}后退 1 帧`}
        onClick={() => onNudge(-1)}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <span className="storyboard-keyword-inline-entry">
        <input
          aria-label={label}
          aria-invalid={invalid}
          value={draft ?? formatted}
          onFocus={(event) => {
            setDraft(formatted);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDraft(value);
            setInvalid(parseMonitorTime(value, frameRate) === null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelledRef.current = true;
              event.currentTarget.blur();
            }
          }}
        />
      </span>
      <button
        type="button"
        title={`${label}前进 1 帧`}
        aria-label={`${label}前进 1 帧`}
        onClick={() => onNudge(1)}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

function keywordText(entries: readonly AssetLibraryEntry[]) {
  const all = [...new Set(entries.flatMap((entry) => entry.annotation.keywords))];
  return all
    .map((keyword) =>
      entries.every((entry) => entry.annotation.keywords.includes(keyword))
        ? keyword
        : `${keyword}${partialKeywordMark}`,
    )
    .join("，");
}

function parsedKeywords(value: string) {
  return value
    .split(/[,，\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

/** Applies an edited keyword list; names still marked partial stay only where they were. */
function keywordRecipe(value: string): AssetLibraryEntryRecipe {
  const names = parsedKeywords(value);
  return (entry) =>
    withAssetLibraryKeywords(
      entry,
      names.flatMap((name) => {
        if (!name.endsWith(partialKeywordMark)) return [name];
        const keyword = name.slice(0, -partialKeywordMark.length).trim();
        return keyword && entry.annotation.keywords.includes(keyword) ? [keyword] : [];
      }),
    );
}

function KeywordEditor({
  entries,
  onUpdate,
}: {
  entries: readonly AssetLibraryEntry[];
  onUpdate: (label: string, recipe: AssetLibraryEntryRecipe) => void;
}) {
  const [entry, setEntry] = useState("");
  const text = keywordText(entries);
  const add = () => {
    const names = parsedKeywords(entry);
    setEntry("");
    if (names.length === 0) return;
    onUpdate("添加关键字", (current) =>
      withAssetLibraryKeywords(current, [...current.annotation.keywords, ...names]),
    );
  };
  return (
    <>
      <PlainEditor
        value={text}
        label="编辑关键字"
        placeholder=""
        submitOnEnter
        title={`星号（*）表示标记仅应用于某些选定的素材。\n\n关键词数量：${parsedKeywords(text).length}`}
        onCommit={(value) => onUpdate("编辑关键字", keywordRecipe(value))}
      />
      <form
        className="storyboard-keyword-inline-entry"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          value={entry}
          aria-label="添加素材关键字"
          placeholder="单击此处添加关键字"
          title="多个关键字用逗号分隔"
          onChange={(event) => setEntry(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") setEntry("");
          }}
        />
      </form>
    </>
  );
}

function AnnotationFields({
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
  return (
    <>
      <Field label="旗标">
        <div className="storyboard-filter-flags" aria-label="旗标">
          {flagOrder.map((value) => (
            <button
              key={value}
              type="button"
              className={flag === value ? "active" : ""}
              title={assetLibraryFlagNames[value]}
              aria-label={assetLibraryFlagNames[value]}
              aria-pressed={flag === value}
              onClick={() => onUpdate("设置旗标", (entry) => withAssetLibraryFlag(entry, value))}
            >
              <StoryboardFlagIcon flag={value} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="星级">
        <div className="storyboard-filter-stars" aria-label="星级">
          {[1, 2, 3, 4, 5].map((value) => {
            const current = rating === value;
            const label = current ? "清除星级" : `${value} 星`;
            return (
              <button
                key={value}
                type="button"
                className={rating !== undefined && value <= rating ? "active" : ""}
                title={label}
                aria-label={label}
                aria-pressed={current}
                onClick={() =>
                  onUpdate("设置星级", (entry) =>
                    withAssetLibraryRating(entry, current ? 0 : value),
                  )
                }
              >
                <Star aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="色标">
        <StoryboardColorLabelButtons
          activeValues={colorLabel ? [colorLabel] : []}
          ariaLabel="色标"
          buttonLabel={(value, label, active) =>
            active
              ? `清除${label}色标`
              : isAssetColorLabel(value)
                ? assetLibraryColorLabelNames[value]
                : label
          }
          onSelect={(value) => {
            if (!isAssetColorLabel(value)) return;
            onUpdate("设置色标", (entry) =>
              withAssetLibraryColorLabel(entry, colorLabel === value ? null : value),
            );
          }}
        />
      </Field>
      <Field label="标签">
        <InlineInput
          value={customLabel ?? ""}
          label="自定义标签"
          placeholder={customLabel === undefined ? "多个值" : "单击此处添加标签"}
          onCommit={(value) =>
            onUpdate("设置标签", (entry) => withAssetLibraryCustomLabel(entry, value))
          }
        />
      </Field>
    </>
  );
}

function EntryProperties({
  entry,
  media,
  thumbnailsEnabled,
  sections,
  onUpdateEntries,
  onPreview,
}: {
  entry: AssetLibraryEntry;
  media: ResolvedAssetMedia | null;
  thumbnailsEnabled: boolean;
  sections: SectionState;
  onUpdateEntries: AssetLibraryDetailsProps["onUpdateEntries"];
  onPreview: (entry: AssetLibraryEntry) => void;
}) {
  const frameRate = entry.media.frame_rate;
  const subtitle = entry.root === "subtitles";
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
      <div className="asset-library-preview">
        <AssetLibraryThumbnail
          entry={entry}
          media={media}
          displayWidth={320}
          enabled={thumbnailsEnabled}
          priority={1}
        />
        <button
          type="button"
          className="asset-library-preview-play"
          disabled={!media}
          title={media ? "在源监视器中预览" : "媒体离线，无法预览"}
          aria-label="在源监视器中预览"
          onClick={() => onPreview(entry)}
        >
          <Play aria-hidden="true" />
        </button>
      </div>
      <Section id="info" title="信息" state={sections}>
        <Field label="名称">
          <InlineInput
            value={entry.name}
            label="名称"
            onCommit={(value) =>
              update("重命名素材", (current) => renamedAssetLibraryEntry(current, value))
            }
          />
        </Field>
        {!subtitle && (
          <Field label="镜头标题">
            <InlineInput
              value={entry.annotation.title ?? ""}
              label="镜头标题"
              placeholder="单击此处添加标题"
              onCommit={(value) =>
                update("设置镜头标题", (current) => withAssetLibraryTitle(current, value))
              }
            />
          </Field>
        )}
        <Field label="来源">
          <ReadOnlyValue
            title={entry.media.path}
            value={
              <>
                {entry.media.file_name}
                {!media && <span className="asset-library-offline-text">离线</span>}
              </>
            }
          />
        </Field>
      </Section>
      <Section id="range" title="切点" state={sections}>
        <Field label="入点">
          <TimecodeControl
            label="入点"
            timeUs={entry.start_us}
            frameRate={frameRate}
            onCommit={(timeUs) => trim(timeUs, Math.max(entry.end_us, timeUs))}
            onNudge={(frames) => {
              const startUs = nudged(entry.start_us, frames);
              if (startUs < entry.end_us) trim(startUs, entry.end_us);
            }}
          />
        </Field>
        <Field label="出点">
          <TimecodeControl
            label="出点"
            timeUs={entry.end_us}
            frameRate={frameRate}
            onCommit={(timeUs) => trim(Math.min(entry.start_us, timeUs), timeUs)}
            onNudge={(frames) => {
              const endUs = nudged(entry.end_us, frames);
              if (endUs > entry.start_us) trim(entry.start_us, endUs);
            }}
          />
        </Field>
        <Field label="持续时间">
          <ReadOnlyValue value={formatMonitorTime(assetLibraryEntryDurationUs(entry), frameRate)} />
        </Field>
      </Section>
      <Section id="annotation" title="标注" state={sections}>
        <AnnotationFields entries={[entry]} onUpdate={(label, recipe) => update(label, recipe)} />
      </Section>
      {!subtitle && (
        <Section id="keywords" title="关键字标记" state={sections}>
          <KeywordEditor entries={[entry]} onUpdate={(label, recipe) => update(label, recipe)} />
        </Section>
      )}
      <Section id="text" title={subtitle ? "字幕文本" : "备注"} state={sections}>
        <PlainEditor
          value={entry.text}
          label={subtitle ? "字幕文本" : "备注"}
          placeholder={subtitle ? "无文本" : "单击此处添加备注"}
          submitOnEnter={false}
          title="按 Ctrl+Enter 确认，Esc 取消"
          onCommit={(value) =>
            update("编辑素材文本", (current) => withAssetLibraryText(current, value))
          }
        />
      </Section>
    </>
  );
}

function FolderProperties({
  folder,
  childCount,
  sections,
  onRename,
}: {
  folder: AssetLibraryFolder;
  childCount: number;
  sections: SectionState;
  onRename: (folderId: string, name: string) => void;
}) {
  return (
    <Section id="info" title="文件夹" state={sections}>
      <Field label="名称">
        <InlineInput
          key={folder.id}
          value={folder.name}
          label="文件夹名称"
          onCommit={(value) => onRename(folder.id, value)}
        />
      </Field>
      <Field label="位置">
        <ReadOnlyValue value={assetLibraryRootLabels[folder.root]} />
      </Field>
      <Field label="内容">
        <ReadOnlyValue value={`${childCount} 项`} />
      </Field>
      <Field label="创建时间">
        <ReadOnlyValue value={new Date(folder.created_at).toLocaleString("zh-CN")} />
      </Field>
    </Section>
  );
}

/** Shows the storyboard-style scrollbar thumb only while the pane actually overflows. */
function useVerticalOverflow() {
  const ref = useRef<HTMLElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const next = element.scrollHeight > element.clientHeight + 1;
      setOverflow((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(element, { childList: true, characterData: true, subtree: true });
    measure();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);
  return { ref, overflow };
}

export function AssetLibraryDetails(props: AssetLibraryDetailsProps) {
  const { folder, entries, collapsedSections, onToggleSection } = props;
  const sections: SectionState = { collapsed: collapsedSections, onToggle: onToggleSection };
  const { ref, overflow } = useVerticalOverflow();
  const open = !collapsedSections.has(panelSection);
  const single = entries.length === 1 ? entries[0]! : null;
  let content: ReactNode;
  if (single) {
    content = (
      <EntryProperties
        key={single.entry.id}
        entry={single.entry}
        media={single.media}
        thumbnailsEnabled={props.thumbnailsEnabled}
        sections={sections}
        onUpdateEntries={props.onUpdateEntries}
        onPreview={props.onPreview}
      />
    );
  } else if (entries.length > 1) {
    const ids = entries.map(({ entry }) => entry.id);
    const update = (label: string, recipe: AssetLibraryEntryRecipe) =>
      props.onUpdateEntries(label, ids, recipe);
    const plain = entries.map(({ entry }) => entry);
    content = (
      <>
        <div className="asset-library-details-summary">已选择 {entries.length} 个素材</div>
        <Section id="annotation" title="标注" state={sections}>
          <AnnotationFields entries={plain} onUpdate={update} />
        </Section>
        {plain.every((entry) => entry.root === "storyboards") && (
          <Section id="keywords" title="关键字标记" state={sections}>
            <KeywordEditor entries={plain} onUpdate={update} />
          </Section>
        )}
      </>
    );
  } else if (folder) {
    content = (
      <FolderProperties
        folder={folder.folder}
        childCount={folder.childCount}
        sections={sections}
        onRename={props.onRenameFolder}
      />
    );
  } else {
    content = <div className="storyboard-keyword-empty">选择素材以查看和编辑属性</div>;
  }
  return (
    <aside
      ref={ref}
      className={`storyboard-keyword-panel asset-library-details${
        overflow ? " has-vertical-overflow" : ""
      }`}
      aria-label="素材属性"
    >
      <StoryboardSidebarHeading
        title="属性"
        open={open}
        onToggle={() => onToggleSection(panelSection)}
      />
      {open && content}
    </aside>
  );
}
