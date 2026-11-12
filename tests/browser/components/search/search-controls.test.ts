import { test, expect } from "../../support/fixtures";
import { SearchPanel } from "../../support/search-panel";

for (const label of ["字幕", "分镜"] as const) {
  test(`${label}快捷规则菜单可切换所有规则`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const quickRule = page.locator(".panel-search-rule");
    await expect(quickRule).toContainText("包含");
    const rules = [
      "包含",
      "包含所有",
      "包含单词",
      "不含",
      "开头为",
      "结尾为",
      "完全相等",
      "为空",
      "不为空",
      "正则表达式",
    ];
    for (const rule of [...rules, "包含"]) {
      await quickRule.click();
      const ruleMenu = page.getByRole("menu", { name: `${label}搜索规则` });
      await ruleMenu.getByRole("menuitemcheckbox", { name: rule, exact: true }).click();
      await expect(quickRule).toContainText(rule);
      await expect(ruleMenu).toHaveCount(0);
      await quickRule.click();
      await expect(
        ruleMenu.getByRole("menuitemcheckbox", { name: rule, exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
    }
  });
  test(`${label}标签聚焦对应字段且可编辑多行内容`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog } = search;
    await entry.click();
    async function checkInput(name: string) {
      const input = dialog.getByLabel(name, { exact: true });
      const previous = await input.inputValue();
      for (const text of [
        "",
        "one",
        "one\ntwo\nthree\nfour\nfive\nsix",
        "short",
        "x".repeat(200),
      ]) {
        await input.fill(text);
        await expect(input).toHaveValue(text);
      }
      await input.fill(previous);
    }
    async function checkFieldFocus(name: string) {
      const input = dialog.getByLabel(name, { exact: true });
      await dialog.getByRole("button", { name: "取消", exact: true }).focus();
      await input.locator("..").locator("label").click();
      await expect(input).toBeFocused();
      await input.click();
      await expect(input).toBeFocused();
    }
    for (const name of ["搜索内容", "排除内容"]) {
      await checkFieldFocus(name);
      await checkInput(name);
    }
    await search.mode("语义", true);
    for (const name of ["正向描述", "反向描述"]) {
      await checkFieldFocus(name);
      await checkInput(name);
    }
  });
}
