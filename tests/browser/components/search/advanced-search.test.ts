import { test, expect } from "../../support/fixtures";
import { SearchPanel } from "../../support/search-panel";

for (const label of ["字幕", "分镜"] as const) {
  test(`${label}取消保留已应用条件，应用同步搜索栏，重置恢复默认值`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { bar, entry, dialog } = search;
    await entry.click();
    await dialog.getByLabel("搜索内容", { exact: true }).fill("draft");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(entry).toBeFocused();
    await expect(bar).toHaveValue("hello");
    await entry.click();
    await dialog.getByRole("button", { name: "匹配规则", exact: true }).click();
    const menu = page.getByRole("menu", { name: "匹配规则" });
    await expect(menu.getByRole("separator")).toHaveCount(3);
    await menu.getByRole("menuitemcheckbox", { name: "正则表达式", exact: true }).click();
    await dialog.getByLabel("搜索内容", { exact: true }).fill("hello.*");
    await dialog.getByLabel("排除内容", { exact: true }).fill("draft\nrough cut");
    await dialog.getByLabel("区分大小写", { exact: true }).check();
    await dialog.getByLabel("最短时长").fill("2");
    await dialog.getByLabel("最长时长").fill("5");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    expect(await search.snapshot()).toMatchObject({
      rule: "regex",
      advanced: {
        caseSensitive: true,
        excludedText: "draft\nrough cut",
        minDuration: "2",
        maxDuration: "5",
      },
    });
    await expect(entry).toHaveClass(/active/);
    await entry.click();
    await dialog.getByRole("button", { name: "重置", exact: true }).click();
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(entry).not.toHaveClass(/active/);
    expect(await search.snapshot()).toMatchObject({
      rule: "contains",
      threshold: label === "字幕" ? 0.01 : 0.001,
    });
  });

  test(`${label}错误关联到具体字段，修正输入后允许应用`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog } = search;
    await entry.click();
    await dialog.getByRole("button", { name: "匹配规则", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "正则表达式", exact: true }).click();
    const query = dialog.getByLabel("搜索内容", { exact: true });
    const apply = dialog.getByRole("button", { name: "应用", exact: true });
    await query.fill("[");
    await expect(query).toHaveAttribute("aria-invalid", "true");
    const errorColor = await dialog.evaluate((element) => {
      const reference = document.createElement("span");
      reference.style.color = "var(--color-danger)";
      element.append(reference);
      const color = getComputedStyle(reference).color;
      reference.remove();
      return color;
    });
    await expect(query).toHaveCSS("border-bottom-color", errorColor);
    for (const edge of ["top", "right", "left"])
      await expect(query).not.toHaveCSS(`border-${edge}-color`, errorColor);
    await expect(apply).toBeDisabled();
    await query.fill("hello.*");
    await dialog.getByLabel("最短时长").fill("2");
    await dialog.getByLabel("最长时长").fill("1");
    for (const name of ["最短时长", "最长时长"])
      await expect(dialog.getByLabel(name)).toHaveAttribute("aria-invalid", "true");
    await expect(apply).toBeDisabled();
    await dialog.getByLabel("最短时长").fill("你好");
    await expect(dialog.getByRole("alert")).toHaveText("最短时长必须为数字。");
    await dialog.getByLabel("最短时长").fill("-1");
    await expect(dialog.getByRole("alert")).toHaveText("最短时长必须为非负数。");
    await dialog.getByLabel("最短时长").fill("0");
    await expect(apply).toBeEnabled();
    await search.mode("语义", true);
    const positive = dialog.getByLabel("正向描述", { exact: true });
    const negative = dialog.getByLabel("反向描述", { exact: true });
    await positive.fill("shared");
    await negative.fill(" shared ");
    await expect(positive).toHaveAttribute("aria-invalid", "true");
    await expect(negative).toHaveAttribute("aria-invalid", "true");
    await expect(negative).toHaveCSS("border-bottom-color", errorColor);
    await expect(dialog.getByRole("alert")).toContainText("重复");
    await negative.fill("crowd");
    await expect(positive).toHaveAttribute("aria-invalid", "false");
    await expect(negative).toHaveAttribute("aria-invalid", "false");
    await expect(apply).toBeEnabled();
  });

  test(`${label}Tab 限制在弹窗内，Esc 先关菜单再取消，快捷键不穿透`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog } = search;
    await page.evaluate(() => {
      (window as any).leakedKeys = [];
      window.addEventListener("keydown", (event) => (window as any).leakedKeys.push(event.key));
    });
    await entry.click();
    await dialog.getByRole("button", { name: "取消", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await page.keyboard.press("j");
    expect(await page.evaluate(() => (window as any).leakedKeys)).toEqual([]);
    await dialog.getByRole("button", { name: "搜索模式", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });

  test(`${label}语义描述可从小窗口应用并由快捷搜索框继续编辑`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const { entry, dialog, bar } = search;
    await page.setViewportSize({ width: 640, height: 480 });
    await entry.click();
    await search.mode("语义", true);
    await dialog.getByLabel("正向描述", { exact: true }).fill("sunset\nbeach");
    await dialog.getByLabel("反向描述", { exact: true }).fill("crowd\ncity");
    await expect(dialog.getByLabel("最低匹配度", { exact: true })).toHaveCount(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(448);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    expect(await search.snapshot()).toMatchObject({
      query: "sunset\nbeach",
      mode: "semantic",
      advanced: { negativePrompts: "crowd\ncity" },
    });
    await expect(bar).toHaveValue("sunset|beach");
    await bar.fill("ocean | beach");
    expect((await search.snapshot()).query).toBe("ocean\nbeach");
  });
}
