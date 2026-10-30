import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  canHighlightSearchRule,
  defaultAdvancedSearch,
  advancedSearchErrors,
  type AdvancedSearchOptions,
  type SearchMode,
  type SearchRule,
} from "../../../core/editor/textSearch";
import { ModalDialog } from "../ModalDialog";
import { SelectDropdown, type SelectDropdownItem } from "../SelectDropdown";
import "./AdvancedSearchDialog.css";
import { searchRuleGroups, searchRuleLabels as ruleLabels } from "./searchRules";

const scopeLabels = { any: "任何可搜索的字段", title: "标题", keywords: "关键字" };
export interface AdvancedSearchDraft {
  query: string;
  mode: SearchMode;
  rule: SearchRule;
  scope?: keyof typeof scopeLabels;
  threshold: number;
  options: AdvancedSearchOptions;
}

export function AdvancedSearchDialog({
  label,
  initial,
  semanticAvailable,
  onApply,
  onClose,
}: {
  label: string;
  initial: AdvancedSearchDraft;
  semanticAvailable: boolean;
  onApply: (value: AdvancedSearchDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fieldId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const inputs = Array.from(ref.current?.querySelectorAll("textarea") ?? []);
    function resize(input: HTMLTextAreaElement) {
      const style = getComputedStyle(input);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      input.style.overflowY = "hidden";
      input.style.height = "0px";
      input.style.height = `${Math.min(parseFloat(style.maxHeight), Math.max(parseFloat(style.minHeight), input.scrollHeight + border))}px`;
      input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
    }
    const widths = new Map(inputs.map((input) => [input, input.getBoundingClientRect().width]));
    inputs.forEach(resize);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const input = entry.target as HTMLTextAreaElement;
        const width = input.getBoundingClientRect().width;
        if (widths.get(input) !== width) {
          widths.set(input, width);
          resize(input);
        }
      }
    });
    inputs.forEach((input) => observer.observe(input));
    return () => observer.disconnect();
  }, [draft.query, draft.options.negativePrompts, draft.options.excludedText, draft.mode]);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const update = (options: Partial<AdvancedSearchOptions>) =>
    setDraft((value) => ({ ...value, options: { ...value.options, ...options } }));
  const semantic = draft.mode === "semantic";
  const errors = advancedSearchErrors(draft.query, draft.mode, draft.rule, draft.options);
  const error = [...new Set(Object.values(errors))].join("；");
  function validation(field: keyof typeof errors) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `${fieldId}-error` : undefined,
    };
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (openMenu) {
        setOpenMenu(null);
      } else onClose();
    }
    if (event.key !== "Tab") return;
    setOpenMenu(null);
    const controls = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
      ) ?? [],
    ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  function dropdown<T extends string>(
    name: string,
    value: T,
    groups: readonly (readonly (readonly [T, string])[])[],
    onChange: (value: T) => void,
  ) {
    const visibleGroups = groups
      .map((group) =>
        group.filter(
          ([id]) =>
            name !== "匹配规则" ||
            draft.mode !== "highlight" ||
            canHighlightSearchRule(id as SearchRule),
        ),
      )
      .filter((group) => group.length);
    const items: SelectDropdownItem<T>[] = visibleGroups.flatMap((group, index) => [
      ...(index > 0 ? [{ type: "separator" as const }] : []),
      ...group.map(([value, label]) => ({ type: "option" as const, value, label })),
    ]);
    return (
      <SelectDropdown
        ariaLabel={name}
        className="advanced-search-dropdown"
        menuVariant="popup"
        items={items}
        value={value}
        onChange={onChange}
        open={openMenu === name}
        onOpenChange={(open) => setOpenMenu(open ? name : null)}
      />
    );
  }

  function apply() {
    if (!error) onApply(draft);
  }

  return (
    <div
      ref={ref}
      className="advanced-search-modal"
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <ModalDialog
        title={`高级搜索`}
        className="advanced-search-dialog"
        bodyClassName="advanced-search-body"
        onCancel={onClose}
        onConfirm={apply}
        actions={
          <>
            <button
              type="button"
              className="modal-dialog-cancel advanced-search-reset"
              onClick={() => {
                setDraft({
                  query: "",
                  mode: "filter",
                  rule: "contains",
                  scope: initial.scope === undefined ? undefined : "any",
                  threshold: 0,
                  options: { ...defaultAdvancedSearch },
                });
              }}
            >
              重置
            </button>
            <button
              type="button"
              className="modal-dialog-confirm"
              disabled={Boolean(error)}
              onClick={apply}
            >
              应用
            </button>
            <button type="button" className="modal-dialog-cancel" onClick={onClose}>
              取消
            </button>
          </>
        }
      >
        <div className="advanced-search-field">
          <span>模式</span>
          {dropdown<SearchMode>(
            "搜索模式",
            draft.mode,
            [
              [
                ["filter", "过滤"],
                ["highlight", "高亮"],
              ],
              ...(semanticAvailable ? [[["semantic", "语义"]] as const] : []),
            ],
            (mode) =>
              setDraft((current) => ({
                ...current,
                mode,
                rule:
                  mode === "highlight" && !canHighlightSearchRule(current.rule)
                    ? "contains"
                    : current.rule,
              })),
          )}
        </div>
        {!semantic && draft.scope !== undefined && (
          <div className="advanced-search-field">
            <span>范围</span>
            {dropdown(
              "搜索范围",
              draft.scope,
              [
                [["any", scopeLabels.any]],
                [
                  ["title", scopeLabels.title],
                  ["keywords", scopeLabels.keywords],
                ],
              ],
              (scope) => setDraft({ ...draft, scope }),
            )}
          </div>
        )}
        {!semantic && (
          <div className="advanced-search-field">
            <span>规则</span>
            {dropdown<SearchRule>(
              "匹配规则",
              draft.rule,
              searchRuleGroups.map((group) =>
                group.map((rule) => [rule, ruleLabels[rule]] as const),
              ),
              (rule) => setDraft({ ...draft, rule }),
            )}
          </div>
        )}

        <div className="advanced-search-field advanced-search-text advanced-search-content">
          <label htmlFor={`${fieldId}-query`}>{semantic ? "正向描述" : "搜索内容"}</label>
          <textarea
            id={`${fieldId}-query`}
            {...validation("query")}
            aria-label={semantic ? "正向描述" : "搜索内容"}
            rows={3}
            value={draft.query}
            disabled={!semantic && (draft.rule === "isEmpty" || draft.rule === "isNotEmpty")}
            placeholder={semantic ? "每行一条" : draft.rule === "regex" ? "例如：第[0-9]+集" : ""}
            title={
              draft.rule === "regex" && !semantic ? "JavaScript 正则，不含两侧 / 和标志" : undefined
            }
            onChange={(event) => setDraft({ ...draft, query: event.target.value })}
          />
        </div>
        {semantic ? (
          <>
            <div className="advanced-search-field advanced-search-text">
              <label htmlFor={`${fieldId}-negative`}>反向描述</label>
              <textarea
                id={`${fieldId}-negative`}
                {...validation("negativePrompts")}
                rows={3}
                value={draft.options.negativePrompts}
                placeholder="每行一条，可留空"
                onChange={(event) => update({ negativePrompts: event.target.value })}
              />
            </div>
          </>
        ) : (
          <>
            <div className="advanced-search-field advanced-search-text">
              <label htmlFor={`${fieldId}-excluded`}>排除内容</label>
              <textarea
                id={`${fieldId}-excluded`}
                rows={3}
                value={draft.options.excludedText}
                placeholder="每行一项，可留空"
                title="按字面匹配，命中任意一项即排除"
                onChange={(event) => update({ excludedText: event.target.value })}
              />
            </div>
            <label className="advanced-search-check">
              <input
                type="checkbox"
                checked={draft.options.caseSensitive}
                onChange={(event) => update({ caseSensitive: event.target.checked })}
              />
              区分大小写
            </label>
          </>
        )}
        <div className="advanced-search-field advanced-search-duration">
          <span>时长（秒）</span>
          <div className="advanced-search-range">
            <input
              aria-label="最短时长"
              {...validation("minDuration")}
              type="text"
              inputMode="decimal"
              value={draft.options.minDuration}
              placeholder="最短"
              onChange={(event) => update({ minDuration: event.target.value })}
            />
            <span>—</span>
            <input
              aria-label="最长时长"
              {...validation("maxDuration")}
              type="text"
              inputMode="decimal"
              value={draft.options.maxDuration}
              placeholder="最长"
              onChange={(event) => update({ maxDuration: event.target.value })}
            />
          </div>
        </div>
        {error && (
          <div id={`${fieldId}-error`} className="advanced-search-error" role="alert">
            {error}
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
