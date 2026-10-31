import { open } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { applyAppearance } from "../../../runtime/theme";
import { invokeCommand, runOperation } from "../../../errors";
import { createFfmpegTaskId } from "../../../platform/tauri/ffmpegProgress";
import { isTauriRuntime } from "../../../platform/tauri/runtime";
import { defaultPreferences, useProjectPort } from "../../../systems/ProjectSystem";
import type { Appearance, Preferences } from "../../../types";
import { ModalDialog } from "../ModalDialog";
import {
  preferencesCategories as categories,
  type PreferencesCategory,
} from "./preferencesCategories";
import "./PreferencesDialog.css";

type PreferencesDraft = Omit<
  Preferences,
  "auto_save_interval_minutes" | "auto_save_max_snapshots"
> & {
  auto_save_interval_minutes: string;
  auto_save_max_snapshots: string;
};

function createDraft(preferences: Preferences): PreferencesDraft {
  return {
    ...preferences,
    appearance: preferences.appearance ?? "darkest",
    auto_save_interval_minutes: String(preferences.auto_save_interval_minutes),
    auto_save_max_snapshots: String(preferences.auto_save_max_snapshots),
  };
}

function validInteger(value: string, max: number) {
  const number = Number(value);
  return value.trim() !== "" && Number.isInteger(number) && number >= 1 && number <= max;
}

interface PreferencesDialogProps {
  open: boolean;
  initialCategory?: PreferencesCategory;
  onClose: () => void;
}

export function PreferencesDialog({
  open: isOpen,
  initialCategory = "general",
  onClose,
}: PreferencesDialogProps) {
  return isOpen ? <PreferencesEditor initialCategory={initialCategory} onClose={onClose} /> : null;
}

function PreferencesEditor({
  initialCategory,
  onClose,
}: {
  initialCategory: PreferencesCategory;
  onClose: () => void;
}) {
  const { preferences, preferencesLoaded, messagePublished } = useProjectPort(
    ["preferences"],
    ["preferencesLoaded", "messagePublished"],
  );
  const [draft, setDraft] = useState(() => createDraft(preferences));
  const savedAppearance = useRef(preferences.appearance ?? "darkest");
  const [category, setCategory] = useState<PreferencesCategory>(initialCategory);
  const [isSaving, setIsSaving] = useState(false);
  const [isChoosingPath, setIsChoosingPath] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const busy = isSaving || isChoosingPath;
  const intervalValid = validInteger(draft.auto_save_interval_minutes, 1440);
  const snapshotsValid = validInteger(draft.auto_save_max_snapshots, 1000);
  const valid = intervalValid && snapshotsValid;

  useLayoutEffect(() => {
    applyAppearance(draft.appearance);
  }, [draft.appearance]);

  useLayoutEffect(() => () => applyAppearance(savedAppearance.current), []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current
      ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function close() {
    if (!busy) onClose();
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    // Keep application shortcuts from editing the project behind this dialog.
    // Escape continues to the shared ModalDialog handler.
    if (event.key !== "Escape") event.stopPropagation();
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
      ) ?? [],
    ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) event.preventDefault();
    else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function navigateCategory(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % categories.length;
    else if (event.key === "ArrowUp") next = (index + categories.length - 1) % categories.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = categories.length - 1;
    else return;
    event.preventDefault();
    setCategory(categories[next].id);
    document.getElementById(`${id}-tab-${categories[next].id}`)?.focus();
  }

  async function browse(key: "cache_dir" | "auto_save_dir" | "ffmpeg_path" | "ffprobe_path") {
    if (busy) return;
    if (!isTauriRuntime()) {
      messagePublished("此功能仅在桌面版可用。");
      return;
    }
    setIsChoosingPath(true);
    try {
      const outcome = await runOperation("preferences.update", () =>
        open(
          key === "cache_dir" || key === "auto_save_dir"
            ? {
                title: key === "cache_dir" ? "选择媒体缓存位置" : "选择自动保存位置",
                directory: true,
                multiple: false,
              }
            : {
                title: key === "ffmpeg_path" ? "选择 FFmpeg" : "选择 ffprobe",
                multiple: false,
                filters: [{ name: "可执行文件", extensions: ["exe"] }],
              },
        ),
      );
      if (outcome.status !== "success") return;
      const picked = outcome.value;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (path) setDraft((current) => ({ ...current, [key]: path }));
    } finally {
      setIsChoosingPath(false);
    }
  }

  async function savePreferences() {
    if (busy || !valid) return;
    if (!isTauriRuntime()) {
      messagePublished("此功能仅在桌面版可用。");
      return;
    }
    setIsSaving(true);
    try {
      const outcome = await runOperation("preferences.update", () =>
        invokeCommand<Preferences>("update_preferences", {
          preferences: {
            ...draft,
            auto_save_interval_minutes: Number(draft.auto_save_interval_minutes),
            auto_save_max_snapshots: Number(draft.auto_save_max_snapshots),
          },
          taskId: createFfmpegTaskId("preferences"),
        }),
      );
      if (outcome.status === "success") {
        savedAppearance.current = outcome.value.appearance ?? "darkest";
        preferencesLoaded(outcome.value);
        messagePublished("已保存首选项。");
        onClose();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div ref={dialogRef} onKeyDown={trapFocus}>
      <ModalDialog
        title="首选项"
        className="modal-dialog-large preferences-dialog"
        bodyClassName="preferences-dialog-body"
        onCancel={close}
        onConfirm={savePreferences}
        actions={
          <>
            <button
              type="button"
              className="preferences-button preferences-reset"
              disabled={busy}
              onClick={() => {
                const defaults = defaultPreferences();
                setDraft((current) => ({
                  ...current,
                  ffmpeg_path: defaults.ffmpeg_path,
                  ffprobe_path: defaults.ffprobe_path,
                }));
              }}
              title="将 FFmpeg 和 ffprobe 恢复为默认命令名，点击确定后生效"
            >
              重置工具路径
            </button>
            {!valid && (
              <span className="preferences-validation" role="status">
                请检查自动保存中的数值。
              </span>
            )}
            <button
              type="button"
              className="modal-dialog-confirm"
              disabled={busy || !valid}
              onClick={savePreferences}
            >
              {isSaving && <Loader2 className="spin" size={12} aria-hidden="true" />}
              {isSaving ? "保存中…" : "确定"}
            </button>
            <button type="button" className="modal-dialog-cancel" disabled={busy} onClick={close}>
              取消
            </button>
          </>
        }
      >
        <div
          className="preferences-categories"
          role="tablist"
          aria-label="首选项分类"
          aria-orientation="vertical"
        >
          {categories.map((item, index) => (
            <button
              key={item.id}
              id={`${id}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={category === item.id}
              aria-controls={`${id}-panel-${item.id}`}
              tabIndex={category === item.id ? 0 : -1}
              onClick={() => setCategory(item.id)}
              onKeyDown={(event) => navigateCategory(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {categories.map((item) => (
          <div
            key={item.id}
            id={`${id}-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${item.id}`}
            className="preferences-content"
            hidden={category !== item.id}
            tabIndex={0}
          >
            {item.id === "general" && (
              <fieldset className="preferences-group" disabled={busy}>
                <legend>启动</legend>
                <label className="preferences-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.show_home_on_startup}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setDraft((current) => ({
                        ...current,
                        show_home_on_startup: checked,
                      }));
                    }}
                  />
                  启动时显示主页
                </label>
                <p className="preferences-description">
                  在主页中快速新建、打开项目或访问最近使用项。
                </p>
                <p className="preferences-description">
                  此设置在下次启动时生效。你也可以随时通过顶部主页按钮打开主页。
                </p>
              </fieldset>
            )}
            {item.id === "appearance" && (
              <div className="preferences-appearance-row">
                <span id={`${id}-appearance-label`}>颜色主题</span>
                <div
                  className="preferences-appearance-options"
                  role="radiogroup"
                  aria-labelledby={`${id}-appearance-label`}
                >
                  {appearanceOptions.map(([value, label], index) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={draft.appearance === value}
                      tabIndex={draft.appearance === value ? 0 : -1}
                      className="preferences-appearance-option"
                      disabled={busy}
                      onClick={() => setDraft((current) => ({ ...current, appearance: value }))}
                      onKeyDown={(event) => {
                        let next = index;
                        if (event.key === "ArrowRight" || event.key === "ArrowDown")
                          next = (index + 1) % appearanceOptions.length;
                        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                          next = (index + appearanceOptions.length - 1) % appearanceOptions.length;
                        else if (event.key === "Home") next = 0;
                        else if (event.key === "End") next = appearanceOptions.length - 1;
                        else return;
                        event.preventDefault();
                        setDraft((current) => ({
                          ...current,
                          appearance: appearanceOptions[next][0],
                        }));
                        event.currentTarget.parentElement
                          ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                          [next]?.focus();
                      }}
                    >
                      <span className="preferences-appearance-frame">
                        <AppearancePreview appearance={value} />
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {item.id === "backup" && (
              <>
                <fieldset className="preferences-group" disabled={busy}>
                  <legend>本地项目</legend>
                  <label className="preferences-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.auto_save_enabled}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        setDraft((current) => ({
                          ...current,
                          auto_save_enabled: enabled,
                          auto_save_interval_minutes:
                            !enabled && !validInteger(current.auto_save_interval_minutes, 1440)
                              ? String(preferences.auto_save_interval_minutes)
                              : current.auto_save_interval_minutes,
                          auto_save_max_snapshots:
                            !enabled && !validInteger(current.auto_save_max_snapshots, 1000)
                              ? String(preferences.auto_save_max_snapshots)
                              : current.auto_save_max_snapshots,
                        }));
                      }}
                    />
                    自动保存项目
                  </label>
                  <NumberField
                    id={`${id}-interval`}
                    label="自动保存时间间隔"
                    value={draft.auto_save_interval_minutes}
                    max={1440}
                    suffix="分钟"
                    valid={intervalValid}
                    disabled={!draft.auto_save_enabled}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, auto_save_interval_minutes: value }))
                    }
                  />
                  <NumberField
                    id={`${id}-snapshots`}
                    label="最大项目版本"
                    value={draft.auto_save_max_snapshots}
                    max={1000}
                    valid={snapshotsValid}
                    disabled={!draft.auto_save_enabled}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, auto_save_max_snapshots: value }))
                    }
                  />
                  <label className="preferences-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.auto_save_current_project}
                      disabled={!draft.auto_save_enabled}
                      title="生成自动保存文件后，同时保存已有路径的当前项目；未命名项目仍需先手动保存"
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setDraft((current) => ({
                          ...current,
                          auto_save_current_project: checked,
                        }));
                      }}
                    />
                    自动保存也会保存当前项目
                  </label>
                </fieldset>
                <fieldset className="preferences-group" disabled={busy}>
                  <legend>自动保存位置</legend>
                  <p className="preferences-description">在您工作时，更改会在后台保存。</p>
                  <PathField
                    id={`${id}-auto-save-dir`}
                    label="位置"
                    value={draft.auto_save_dir}
                    placeholder={
                      draft.cache_dir
                        ? `${draft.cache_dir.replace(/[\\/]+$/, "")}/Locution Pro Auto-Save`
                        : "使用缓存目录下的 Locution Pro Auto-Save"
                    }
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, auto_save_dir: value }))
                    }
                    onBrowse={() => browse("auto_save_dir")}
                  />
                </fieldset>
              </>
            )}
            {item.id === "cache" && (
              <>
                <fieldset className="preferences-group" disabled={busy}>
                  <legend>缓存位置</legend>
                  <p className="preferences-description">用于存放媒体缓存。</p>
                  <PathField
                    id={`${id}-cache`}
                    label="缓存路径"
                    value={draft.cache_dir}
                    placeholder="留空使用应用默认缓存目录"
                    onChange={(value) => setDraft((current) => ({ ...current, cache_dir: value }))}
                    onBrowse={() => browse("cache_dir")}
                  />
                </fieldset>
                <p className="preferences-note">
                  请选择空间充足、稳定且可写的本地目录。更改后，新生成的缓存使用新位置，已有文件不会自动迁移。
                </p>
              </>
            )}
            {item.id === "tools" && (
              <>
                <fieldset className="preferences-group" disabled={busy}>
                  <legend>媒体处理</legend>
                  <p className="preferences-description">用于媒体处理、创建代理和导出。</p>
                  <PathField
                    id={`${id}-ffmpeg`}
                    label="FFmpeg"
                    value={draft.ffmpeg_path}
                    placeholder="ffmpeg"
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, ffmpeg_path: value }))
                    }
                    onBrowse={() => browse("ffmpeg_path")}
                  />
                </fieldset>
                <fieldset className="preferences-group" disabled={busy}>
                  <legend>媒体信息</legend>
                  <p className="preferences-description">用于读取媒体流、时长和编码信息。</p>
                  <PathField
                    id={`${id}-ffprobe`}
                    label="ffprobe"
                    value={draft.ffprobe_path}
                    placeholder="ffprobe"
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, ffprobe_path: value }))
                    }
                    onBrowse={() => browse("ffprobe_path")}
                  />
                </fieldset>
                <p className="preferences-note">
                  可输入命令名或选择可执行文件，建议使用同一套发行版。重置工具路径只修改当前草稿，点击“确定”后生效。
                </p>
              </>
            )}
          </div>
        ))}
      </ModalDialog>
    </div>
  );
}

const appearanceOptions: ReadonlyArray<readonly [Appearance, string]> = [
  ["darkest", "最暗"],
  ["dark", "深色"],
  ["light", "浅色"],
];

function AppearancePreview({ appearance }: { appearance: Appearance }) {
  return (
    <svg
      data-theme={appearance}
      className="preferences-appearance-preview"
      viewBox="0 0 120 80"
      aria-hidden="true"
    >
      <rect width="120" height="80" fill="var(--color-surface-canvas)" />
      <path d="M1 1h118v12H1z" fill="var(--color-surface-section-header)" />
      <g fill="var(--color-text-default)">
        <circle cx="6" cy="6" r="1.5" />
        <circle cx="12" cy="6" r="1.5" />
        <circle cx="18" cy="6" r="1.5" />
        <path d="M99 5h16v1H99z" />
      </g>
      <path d="M1 15h13v64H1zM91 15h28v64H91z" fill="var(--color-surface-raised)" />
      <path d="M19 20h66v51H19z" fill="var(--color-surface-thumbnail)" />
      <path d="M28 28h48v29H28z" fill="var(--color-contrast-inverse)" />
      <path d="m4 21 5 4-5 2zM94 22h5v2h-5z" fill="var(--color-accent-monitor)" />
      <g stroke="var(--color-text-default)" fill="var(--color-surface-raised)" strokeWidth="1.5">
        <path d="M103 23h10M94 34h9" />
        <circle cx="105" cy="23" r="2.5" />
        <circle cx="105" cy="34" r="2.5" />
      </g>
    </svg>
  );
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  max: number;
  suffix?: string;
  valid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}

function NumberField({
  id,
  label,
  value,
  max,
  suffix,
  valid,
  disabled,
  onChange,
}: NumberFieldProps) {
  return (
    <div className="preferences-number-field">
      <label htmlFor={id}>{label}：</label>
      <input
        id={id}
        type="number"
        min={1}
        max={max}
        step={1}
        disabled={disabled}
        value={value}
        aria-invalid={!valid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <span>{suffix}</span>
      <small id={`${id}-hint`} className="preferences-validation">
        {!valid && `请输入 1–${max} 的整数`}
      </small>
    </div>
  );
}

interface PathFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}

function PathField({ id, label, value, placeholder, onChange, onBrowse }: PathFieldProps) {
  return (
    <div className="preferences-path-field">
      <label htmlFor={id}>{label}：</label>
      <input
        id={id}
        value={value}
        title={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button
        type="button"
        className="preferences-button"
        onClick={onBrowse}
        aria-label={`浏览${label}`}
      >
        浏览…
      </button>
    </div>
  );
}
