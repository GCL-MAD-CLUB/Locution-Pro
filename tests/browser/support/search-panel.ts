import type { Locator, Page } from "@playwright/test";
import type {
  AdvancedSearchOptions,
  SearchMode,
  SearchRule,
} from "../../../src/core/editor/textSearch";

export type SearchPanelLabel = "字幕" | "分镜";
export interface SearchSnapshot {
  query: string;
  mode: SearchMode;
  rule: SearchRule;
  scope?: "any" | "title" | "keywords";
  threshold: number;
  advanced: AdvancedSearchOptions;
}

export class SearchPanel {
  readonly bar: Locator;
  readonly entry: Locator;
  readonly dialog: Locator;

  constructor(
    readonly page: Page,
    readonly label: SearchPanelLabel,
  ) {
    this.bar = page.getByRole("combobox");
    this.entry = page.getByRole("button", { name: `${label}高级搜索`, exact: true });
    this.dialog = page.getByRole("dialog");
  }

  async mount(panelState = false) {
    await this.page.goto("/tests/browser/support/blank.html");
    await this.page.evaluate(
      async ({ label, panelState }) => {
        const path = "/tests/browser/components/search/advanced-search.harness.js";
        const module = await import(/* @vite-ignore */ path);
        if (panelState) module.mountAdvancedSearchWithPanelState(label);
        else module.mountAdvancedSearch(label);
      },
      { label: this.label, panelState },
    );
  }

  snapshot(): Promise<SearchSnapshot> {
    return this.page.evaluate(() => (window as any).searchSnapshot);
  }

  async mode(mode: "过滤" | "高亮" | "语义", advanced = false) {
    await (
      advanced
        ? this.dialog.getByRole("button", { name: "搜索模式", exact: true })
        : this.page.locator(".panel-search-mode")
    ).click();
    await this.page.getByRole("menuitemcheckbox", { name: mode, exact: true }).click();
  }
}
