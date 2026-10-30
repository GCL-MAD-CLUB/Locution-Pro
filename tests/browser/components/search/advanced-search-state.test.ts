import { test, expect } from "../../support/fixtures";
import { SearchPanel } from "../../support/search-panel";

for (const label of ["字幕", "分镜"] as const) {
  test(`${label}清空搜索同时复位高级条件且报错只在弹窗中显示`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount(true);
    const bar = page.getByRole("combobox");
    const entry = page.getByRole("button", { name: `${label}高级搜索` });
    const dialog = page.getByRole("dialog");
    const options = () => page.evaluate(() => (window as any).searchSnapshot.advanced);
    const defaults = {
      caseSensitive: false,
      excludedText: "",
      negativePrompts: "",
      minDuration: "",
      maxDuration: "",
    };
    await bar.fill("sunset");
    await entry.click();
    await dialog.getByLabel("排除内容", { exact: true }).fill("draft");
    await dialog.getByLabel("区分大小写", { exact: true }).check();
    await dialog.getByLabel("最短时长", { exact: true }).fill("1");
    await dialog.getByLabel("最长时长", { exact: true }).fill("3");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).toHaveClass(/active/);
    await bar.clear();
    expect(await options()).toEqual(defaults);
    await expect(entry).not.toHaveClass(/active/);
    await bar.fill("sunset");
    await entry.click();
    await dialog.getByLabel("排除内容", { exact: true }).fill("draft");
    await dialog.getByLabel("区分大小写", { exact: true }).check();
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await page.locator(".panel-search-mode").click();
    await page.getByRole("menuitemcheckbox", { name: "语义", exact: true }).click();
    await entry.click();
    await dialog.getByLabel("反向描述", { exact: true }).fill("crowd");
    await dialog.getByLabel("最短时长", { exact: true }).fill("1");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await bar.fill("crowd");
    await expect(bar).not.toHaveAttribute("aria-invalid");
    await expect(page.locator(".panel-search-row [role='alert']")).toHaveCount(0);
    await entry.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await bar.clear();
    expect(await options()).toEqual(defaults);
    await expect(entry).not.toHaveClass(/active/);
    await expect(bar).not.toHaveAttribute("aria-invalid");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await entry.click();
    await expect(dialog.getByLabel("反向描述", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("最短时长", { exact: true })).toHaveValue("");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.locator(".panel-search-mode").click();
    await page.getByRole("menuitemcheckbox", { name: "过滤", exact: true }).click();
    await page.locator(".panel-search-rule").click();
    await page.getByRole("menuitemcheckbox", { name: "正则表达式", exact: true }).click();
    await bar.fill("[");
    await expect(bar).not.toHaveAttribute("aria-invalid");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await entry.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("搜索内容", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test(`${label}仅在当前模式使用快捷栏未展示的条件时启用高级入口`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount(true);
    const entry = page.getByRole("button", { name: `${label}高级搜索` });
    const dialog = page.getByRole("dialog");
    async function quickMode(name: string) {
      await page.locator(".panel-search-mode").click();
      await page
        .getByRole("menu", { name: `${label}搜索模式` })
        .getByRole("menuitemcheckbox", { name, exact: true })
        .click();
    }
    await page.getByRole("combobox").fill("one two");
    await expect(entry).not.toHaveClass(/active/);
    await page.locator(".panel-search-rule").click();
    await page
      .getByRole("menu", { name: `${label}搜索规则` })
      .getByRole("menuitemcheckbox", { name: "完全相等", exact: true })
      .click();
    await expect(entry).not.toHaveClass(/active/);
    await entry.click();
    await dialog.getByLabel("区分大小写", { exact: true }).check();
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).toHaveClass(/active/);
    await quickMode("语义");
    await expect(entry).not.toHaveClass(/active/);
    await entry.click();
    await dialog.getByLabel("正向描述", { exact: true }).fill("one\ntwo");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page.getByRole("combobox")).toHaveValue("one|two");
    await expect(entry).not.toHaveClass(/active/);
    await entry.click();
    await dialog.getByLabel("反向描述", { exact: true }).fill("negative");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).toHaveClass(/active/);
    await entry.click();
    await dialog.getByLabel("反向描述", { exact: true }).fill("");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).not.toHaveClass(/active/);
    for (const field of ["最短时长", "最长时长"]) {
      await entry.click();
      await dialog.getByLabel(field, { exact: true }).fill("2");
      await dialog.getByRole("button", { name: "应用", exact: true }).click();
      await expect(entry).toHaveClass(/active/);
      await entry.click();
      await dialog.getByLabel(field, { exact: true }).fill(" ");
      await dialog.getByRole("button", { name: "应用", exact: true }).click();
      await expect(entry).not.toHaveClass(/active/);
    }
    await quickMode("过滤");
    await expect(entry).toHaveClass(/active/);
    await entry.click();
    await dialog.getByLabel("区分大小写", { exact: true }).uncheck();
    await dialog.getByLabel("排除内容", { exact: true }).fill("excluded");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).toHaveClass(/active/);
    await quickMode("语义");
    await expect(entry).not.toHaveClass(/active/);
  });
  test(`${label}真实面板状态在搜索栏和高级搜索切换模式时保留内容`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount(true);
    const bar = page.getByRole("combobox");
    await bar.fill("保留搜索|内容");
    for (const mode of ["高亮", "语义", "过滤", "语义", "高亮", "过滤"]) {
      await page.locator(".panel-search-mode").click();
      await page
        .getByRole("menu", { name: `${label}搜索模式` })
        .getByRole("menuitemcheckbox", { name: mode, exact: true })
        .click();
      await expect(bar).toHaveValue("保留搜索|内容");
      if (mode === "语义")
        await expect(page.getByLabel("语义匹配度阈值，范围 0 到 1", { exact: true })).toHaveValue(
          label === "字幕" ? "0.01" : "0.001",
        );
      expect(await page.evaluate(() => (window as any).searchSnapshot.query)).toBe("保留搜索|内容");
    }
    await page.getByRole("button", { name: `${label}高级搜索` }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "搜索内容", exact: true })
      .fill("保留完整 内容\n多行 描述");
    for (const mode of ["语义", "高亮", "过滤", "高亮", "语义", "过滤"]) {
      await dialog.getByRole("button", { name: "搜索模式", exact: true }).click();
      await page
        .getByRole("menu", { name: "搜索模式", exact: true })
        .getByRole("menuitemcheckbox", { name: mode, exact: true })
        .click();
      await expect(
        dialog.getByRole("textbox", {
          name: mode === "语义" ? "正向描述" : "搜索内容",
          exact: true,
        }),
      ).toHaveValue("保留完整 内容\n多行 描述");
    }
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(bar).toHaveValue("保留完整 内容 多行 描述");
  });
}
