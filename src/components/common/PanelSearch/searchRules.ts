import type { SearchRule } from "../../../core/editor/textSearch";

export const searchRuleLabels: Record<SearchRule, string> = {
  contains: "包含",
  containsAll: "包含所有",
  containsWords: "包含单词",
  doesNotContain: "不含",
  startsWith: "开头为",
  endsWith: "结尾为",
  equals: "完全相等",
  isEmpty: "为空",
  isNotEmpty: "不为空",
  regex: "正则表达式",
};

export const searchRuleGroups = [
  ["contains", "containsAll", "containsWords", "doesNotContain"],
  ["startsWith", "endsWith", "equals"],
  ["isEmpty", "isNotEmpty"],
  ["regex"],
] as const satisfies readonly (readonly SearchRule[])[];
