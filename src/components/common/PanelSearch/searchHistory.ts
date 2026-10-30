import { readAppStorage } from "../../../runtime/storage";
import {
  canHighlightSearchRule,
  advancedSearchErrors,
  defaultAdvancedSearch,
  defaultSemanticThreshold,
  searchQueryToSingleLine,
  type AdvancedSearchOptions,
  type SearchMode,
  type SearchRule,
} from "../../../core/editor/textSearch";
import { searchRuleLabels } from "./searchRules";

export type SearchHistoryKind = "subtitle" | "storyboard";
export type SearchHistorySpace = "text" | "semantic";
export interface SearchConfiguration {
  query: string;
  mode: SearchMode;
  rule: SearchRule;
  scope?: "any" | "title" | "keywords";
  threshold: number;
  options: AdvancedSearchOptions;
}
export interface SearchHistoryEntry {
  text: string;
  configuration: SearchConfiguration;
}

const historyLimit = 6;
type HistoryStorage = Pick<Storage, "getItem" | "setItem">;
export function searchHistorySpace(mode: SearchMode): SearchHistorySpace {
  return mode === "semantic" ? "semantic" : "text";
}

export function searchHistoryText(configuration: SearchConfiguration) {
  return searchQueryToSingleLine(configuration.query, configuration.mode);
}

export function hasAdvancedSearch(configuration: SearchConfiguration) {
  const { options, mode } = configuration;
  return (
    Boolean(options.minDuration.trim() || options.maxDuration.trim()) ||
    (mode === "semantic"
      ? Boolean(options.negativePrompts.trim())
      : options.caseSensitive || Boolean(options.excludedText.trim()))
  );
}

function historyKey(kind: SearchHistoryKind, space: SearchHistorySpace) {
  return `locution-pro:search-history:${kind}:${space}`;
}

function parseConfiguration(value: unknown): SearchConfiguration | null {
  if (!value || typeof value !== "object") return null;
  const { query, mode, rule, scope, threshold, options } = value as Partial<SearchConfiguration>;
  if (
    typeof query !== "string" ||
    (mode !== "filter" && mode !== "highlight" && mode !== "semantic") ||
    typeof rule !== "string" ||
    !Object.hasOwn(searchRuleLabels, rule) ||
    (scope !== undefined && !["any", "title", "keywords"].includes(scope)) ||
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1 ||
    !options ||
    typeof options !== "object" ||
    typeof options.caseSensitive !== "boolean" ||
    ![
      options.excludedText,
      options.negativePrompts,
      options.minDuration,
      options.maxDuration,
    ].every((item) => typeof item === "string") ||
    (mode === "highlight" && !canHighlightSearchRule(rule)) ||
    Object.keys(advancedSearchErrors(query, mode, rule, options)).length > 0
  )
    return null;
  return {
    query,
    mode,
    rule,
    scope,
    threshold,
    options: {
      caseSensitive: options.caseSensitive,
      excludedText: options.excludedText,
      negativePrompts: options.negativePrompts,
      minDuration: options.minDuration,
      maxDuration: options.maxDuration,
    },
  };
}

function normalizeHistory(value: unknown, space: SearchHistorySpace): SearchHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: SearchHistoryEntry[] = [];
  const texts = new Set<string>();
  for (const item of value) {
    const configuration = parseConfiguration(item?.configuration);
    if (!configuration || searchHistorySpace(configuration.mode) !== space) continue;
    const text = searchHistoryText(configuration);
    if (!text || texts.has(text)) continue;
    entries.push({ text, configuration });
    texts.add(text);
    if (entries.length === historyLimit) break;
  }
  return entries;
}

export function readSearchHistory(
  kind: SearchHistoryKind,
  space: SearchHistorySpace,
  storage?: HistoryStorage,
): SearchHistoryEntry[] {
  try {
    const stored = readAppStorage(historyKey(kind, space), storage);
    if (stored !== null) return normalizeHistory(JSON.parse(stored), space);
    if (space === "semantic") return [];
    const legacy = readAppStorage(`locution-pro:search-history:${kind}`, storage);
    const queries: unknown = legacy ? JSON.parse(legacy) : [];
    return normalizeHistory(
      Array.isArray(queries)
        ? queries
            .filter((query) => typeof query === "string")
            .map((query) => ({
              configuration: {
                query,
                mode: "filter",
                rule: kind === "subtitle" ? "containsAll" : "contains",
                scope: kind === "storyboard" ? "any" : undefined,
                threshold: defaultSemanticThreshold[kind],
                options: { ...defaultAdvancedSearch },
              },
            }))
        : [],
      space,
    );
  } catch {
    // Optional history must not interrupt searching when storage is unavailable.
    return [];
  }
}

export function rememberSearch(
  kind: SearchHistoryKind,
  configuration: SearchConfiguration,
  storage?: HistoryStorage,
): SearchHistoryEntry[] {
  const space = searchHistorySpace(configuration.mode);
  const history = readSearchHistory(kind, space, storage);
  const valid = parseConfiguration(configuration);
  if (!valid || !searchHistoryText(valid)) return history;
  const next = normalizeHistory([{ configuration: valid }, ...history], space);
  try {
    (storage ?? window.localStorage).setItem(historyKey(kind, space), JSON.stringify(next));
  } catch {
    // Keep the interaction usable even if persistence is unavailable.
  }
  return next;
}

export function filterSearchHistory(
  history: readonly SearchHistoryEntry[],
  query: string,
): SearchHistoryEntry[] {
  const prefix = query.trim().toLocaleLowerCase();
  return history.filter((entry) => entry.text.toLocaleLowerCase().startsWith(prefix));
}
