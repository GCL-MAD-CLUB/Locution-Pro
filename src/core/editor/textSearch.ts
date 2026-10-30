export type SearchMode = "filter" | "highlight" | "semantic";
export const defaultSemanticThreshold = { subtitle: 0.01, storyboard: 0.001 } as const;
export type SearchRule =
  | "contains"
  | "containsAll"
  | "containsWords"
  | "doesNotContain"
  | "startsWith"
  | "endsWith"
  | "equals"
  | "regex"
  | "isEmpty"
  | "isNotEmpty";

export function canHighlightSearchRule(rule: SearchRule) {
  return rule !== "doesNotContain" && rule !== "isEmpty" && rule !== "isNotEmpty";
}

function searchTerms(query: string, caseSensitive = false) {
  const normalized = caseSensitive ? query.trim() : query.trim().toLocaleLowerCase();
  return normalized ? (normalized.match(/[\p{L}\p{N}_]+/gu) ?? [normalized]) : [];
}

function termPattern(term: string, wholeWord: boolean, caseSensitive = false) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped,
    caseSensitive ? "gu" : "giu",
  );
}

export interface AdvancedSearchOptions {
  caseSensitive: boolean;
  excludedText: string;
  negativePrompts: string;
  minDuration: string;
  maxDuration: string;
}

export const defaultAdvancedSearch: AdvancedSearchOptions = {
  caseSensitive: false,
  excludedText: "",
  negativePrompts: "",
  minDuration: "",
  maxDuration: "",
};

export function searchLines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function searchQueryToMultiline(query: string, mode: SearchMode) {
  return mode === "semantic"
    ? query
        .split(/[|\r\n\u2028\u2029]+/u)
        .map((prompt) => prompt.trim())
        .filter(Boolean)
        .join("\n")
    : query.trim().replace(/\s+/gu, "\n");
}

export function searchQueryToSingleLine(query: string, mode: SearchMode) {
  return mode === "semantic"
    ? searchQueryToMultiline(query, mode).split("\n").join("|")
    : query.trim().replace(/\s+/gu, " ");
}

export function searchPatternError(query: string, rule: SearchRule): string | null {
  query = searchQueryToSingleLine(query, "filter");
  if (rule !== "regex" || !query.trim()) return null;
  try {
    new RegExp(query.trim(), "u");
    return null;
  } catch {
    return "正则表达式无效，请检查括号、字符集和转义符。";
  }
}

export const MAX_SEMANTIC_PROMPTS = 10;
export const MAX_PROMPT_CHARACTERS = 1000;

/** ASCII counts as one character; other Unicode code points count as two. */
export function promptCharacterCount(value: string) {
  return Array.from(value).reduce(
    (count, character) => count + (character.codePointAt(0)! <= 0x7f ? 1 : 2),
    0,
  );
}

export type AdvancedSearchErrors = Partial<
  Record<"query" | "negativePrompts" | "minDuration" | "maxDuration", string>
>;

function promptItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Semantic prompt limits and role conflicts. Independent of rule and duration
 * options, so dispatching a semantic request only needs the prompts themselves.
 */
export function semanticPromptErrors(query: string, negativePrompts: string): AdvancedSearchErrors {
  const errors: AdvancedSearchErrors = {};
  const positive = promptItems(searchQueryToMultiline(query, "semantic"));
  const negative = promptItems(negativePrompts);
  for (const [field, label, prompts] of [
    ["query", "正向描述", positive],
    ["negativePrompts", "反向描述", negative],
  ] as const) {
    if (prompts.length > MAX_SEMANTIC_PROMPTS)
      errors[field] = `${label}最多 ${MAX_SEMANTIC_PROMPTS} 项。`;
    else {
      const index = prompts.findIndex(
        (prompt) => promptCharacterCount(prompt) > MAX_PROMPT_CHARACTERS,
      );
      if (index >= 0)
        errors[field] =
          `${label}第 ${index + 1} 项超过 ${MAX_PROMPT_CHARACTERS} 字符（中文计 2）。`;
    }
  }
  if (positive.some((prompt) => negative.includes(prompt))) {
    errors.query ??= "正向与反向描述有重复项。";
    errors.negativePrompts ??= "正向与反向描述有重复项。";
  }
  if (!positive.length && negative.length) errors.query = "请至少填写一条正向描述。";
  return errors;
}

export function advancedSearchErrors(
  query: string,
  mode: SearchMode,
  rule: SearchRule,
  options: AdvancedSearchOptions,
): AdvancedSearchErrors {
  const errors: AdvancedSearchErrors = {};
  if (mode === "semantic") {
    Object.assign(errors, semanticPromptErrors(query, options.negativePrompts));
  } else {
    const error = searchPatternError(query, rule);
    if (error) errors.query = error;
  }
  for (const field of ["minDuration", "maxDuration"] as const) {
    const value = options[field].trim();
    const label = `${field === "minDuration" ? "最短" : "最长"}时长`;
    if (value && !Number.isFinite(Number(value))) errors[field] = `${label}必须为数字。`;
    else if (value && Number(value) < 0) errors[field] = `${label}必须为非负数。`;
  }
  if (
    !errors.minDuration &&
    !errors.maxDuration &&
    options.minDuration.trim() &&
    options.maxDuration.trim() &&
    Number(options.minDuration) > Number(options.maxDuration)
  ) {
    errors.minDuration = errors.maxDuration = "最短时长不能大于最长时长。";
  }
  return errors;
}

export function matchesSearchDuration(
  startUs: number,
  endUs: number,
  options: AdvancedSearchOptions,
) {
  const seconds = Math.max(0, endUs - startUs) / 1_000_000;
  return (
    (!options.minDuration.trim() || seconds >= Number(options.minDuration)) &&
    (!options.maxDuration.trim() || seconds <= Number(options.maxDuration))
  );
}

export function matchesTextSearch(
  values: readonly string[],
  query: string,
  rule: SearchRule,
  options: Pick<AdvancedSearchOptions, "caseSensitive" | "excludedText"> = defaultAdvancedSearch,
) {
  query = searchQueryToSingleLine(query, "filter");
  const normalize = (value: string) =>
    options.caseSensitive ? value.trim() : value.trim().toLocaleLowerCase();
  const populated = values.map(normalize).filter(Boolean);
  if (
    searchLines(options.excludedText).some((term) =>
      populated.some((value) => value.includes(normalize(term))),
    )
  )
    return false;
  if (rule === "isEmpty") return populated.length === 0;
  if (rule === "isNotEmpty") return populated.length > 0;
  const normalized = normalize(query);
  if (!normalized) return true;
  const text = populated.join(" ");
  const terms = searchTerms(query, options.caseSensitive);
  switch (rule) {
    case "regex":
      if (searchPatternError(query, rule)) return false;
      return values.some((value) =>
        new RegExp(query.trim(), options.caseSensitive ? "u" : "iu").test(value.trim()),
      );
    case "equals":
      return populated.some((value) => value === normalized);
    case "contains":
      return terms.some((term) => text.includes(term));
    case "containsAll":
      return terms.every((term) => text.includes(term));
    case "containsWords":
      return terms.every((term) => termPattern(term, true, options.caseSensitive).test(text));
    case "doesNotContain":
      return terms.every((term) => !text.includes(term));
    case "startsWith":
      return populated.some((value) => value.startsWith(normalized));
    case "endsWith":
      return populated.some((value) => value.endsWith(normalized));
  }
}

export interface SearchRange {
  start: number;
  end: number;
}

/** Ranges refer to the original text, so casing and Unicode offsets are preserved. */
export function textSearchRanges(
  text: string,
  query: string,
  rule: SearchRule,
  fields: readonly SearchRange[] = [{ start: 0, end: text.length }],
  options: Pick<AdvancedSearchOptions, "caseSensitive"> = defaultAdvancedSearch,
): SearchRange[] {
  query = searchQueryToSingleLine(query, "highlight");
  if (!query.trim() || !canHighlightSearchRule(rule)) return [];
  const ranges: SearchRange[] = [];
  if (rule === "regex" || rule === "equals") {
    if (searchPatternError(query, rule)) return [];
    for (const field of fields) {
      const value = text.slice(field.start, field.end);
      const pattern =
        rule === "regex"
          ? new RegExp(query.trim(), options.caseSensitive ? "gu" : "giu")
          : termPattern(query.trim(), false, options.caseSensitive);
      for (const match of value.matchAll(pattern)) {
        if (!match[0].length) continue;
        if (
          rule === "equals" &&
          (value.slice(0, match.index).trim() || value.slice(match.index + match[0].length).trim())
        )
          continue;
        ranges.push({
          start: field.start + match.index,
          end: field.start + match.index + match[0].length,
        });
      }
    }
  } else if (rule === "startsWith" || rule === "endsWith") {
    for (const field of fields) {
      const value = text.slice(field.start, field.end);
      for (const match of value.matchAll(termPattern(query.trim(), false, options.caseSensitive))) {
        const start = match.index;
        const end = start + match[0].length;
        if (rule === "startsWith" ? !value.slice(0, start).trim() : !value.slice(end).trim()) {
          ranges.push({ start: field.start + start, end: field.start + end });
        }
      }
    }
  } else {
    for (const term of searchTerms(query, options.caseSensitive)) {
      for (const match of text.matchAll(
        termPattern(term, rule === "containsWords", options.caseSensitive),
      )) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }
  const merged: SearchRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Navigate in display order, wrapping at either end, including from a nonmatching row. */
export function nextSearchMatchIndex(
  matchingIndices: readonly number[],
  currentIndex: number,
  direction: -1 | 1,
) {
  if (!matchingIndices.length) return -1;
  if (direction === 1) {
    return matchingIndices.find((index) => index > currentIndex) ?? matchingIndices[0];
  }
  for (let index = matchingIndices.length - 1; index >= 0; index--) {
    if (matchingIndices[index] < currentIndex) return matchingIndices[index];
  }
  return matchingIndices.at(-1)!;
}
