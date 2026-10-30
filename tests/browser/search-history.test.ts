import { test, expect } from "@playwright/test";

for (const label of ["字幕", "分镜"]) {
  test(`${label}最近搜索恢复完整配置、分区与高级星号`, async ({ page }) => {
    const kind = label === "字幕" ? "subtitle" : "storyboard";
    await page.goto("/tests/browser/blank.html");
    await page.evaluate(
      async ({ label, kind }) => {
        const historyPath = "/src/components/common/PanelSearch/searchHistory.ts";
        const corePath = "/src/core/editor/textSearch.ts";
        const harnessPath = "/tests/browser/advanced-search.harness.js";
        const { rememberSearch } = await import(/* @vite-ignore */ historyPath);
        const { defaultAdvancedSearch } = await import(/* @vite-ignore */ corePath);
        const config = {
          query: "alpha beta",
          mode: "highlight",
          rule: "equals",
          scope: label === "分镜" ? "keywords" : undefined,
          threshold: 0.321,
          options: {
            ...defaultAdvancedSearch,
            excludedText: "draft",
            caseSensitive: true,
            minDuration: "1",
            maxDuration: "3",
          },
        };
        rememberSearch(kind, config);
        rememberSearch(kind, { ...config, query: "other" });
        rememberSearch(kind, {
          ...config,
          mode: "semantic",
          query: "sunset\nbeach",
          options: { ...defaultAdvancedSearch, negativePrompts: "crowd\ncity" },
        });
        rememberSearch(kind, { ...config, mode: "semantic", query: "forest" });
        const { mountAdvancedSearch } = await import(/* @vite-ignore */ harnessPath);
        mountAdvancedSearch(label);
      },
      { label, kind },
    );
    const read = (space: string) =>
      page.evaluate(
        ({ kind, space }) =>
          JSON.parse(localStorage.getItem(`locution-pro:search-history:${kind}:${space}`) ?? "[]"),
        { kind, space },
      );
    const bar = page.getByRole("combobox");
    const advanced = page.getByRole("button", { name: `${label}高级搜索` });
    await bar.fill("");
    const option = page.getByRole("option", { name: "alpha beta", exact: true });
    await expect(option).toBeVisible();
    await expect(page.getByRole("option", { name: "sunset|beach", exact: true })).toHaveCount(0);
    const star = option.locator(".panel-search-history-advanced");
    await expect(star).toHaveText("*");
    expect(await star.evaluate((element) => getComputedStyle(element).color)).toBe(
      "rgb(64, 150, 243)",
    );
    expect((await read("text"))[0].text).toBe("other");
    await option.click();
    await expect(bar).toBeFocused();
    await expect(bar).toHaveValue("alpha beta");
    const restored = await page.evaluate(() => (window as any).searchSnapshot);
    expect(restored).toMatchObject({
      mode: "highlight",
      rule: "equals",
      threshold: 0.321,
      advanced: { excludedText: "draft", caseSensitive: true, minDuration: "1", maxDuration: "3" },
    });
    if (label === "分镜") expect(restored.scope).toBe("keywords");
    const afterMouseSelection = await read("text");
    expect(afterMouseSelection.map((entry: any) => entry.text)).toEqual(["alpha beta", "other"]);
    expect(afterMouseSelection[0].configuration.options.excludedText).toBe("draft");
    expect((await read("semantic"))[0].text).toBe("forest");
    await advanced.click();
    const dialog = page.getByRole("dialog");
    expect((await read("text"))[0].text).toBe("alpha beta");
    await expect(dialog.getByLabel("排除内容", { exact: true })).toHaveValue("draft");
    await dialog.getByLabel("排除内容", { exact: true }).fill("updated");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    const updated = await read("text");
    expect(updated).toHaveLength(2);
    expect(updated[0].configuration.options.excludedText).toBe("updated");
    await bar.fill("");
    await page.locator(".panel-search-mode").click();
    await page.getByRole("menuitemcheckbox", { name: "语义", exact: true }).click();
    await bar.focus();
    await bar.click();
    await expect(page.getByRole("option", { name: "alpha beta", exact: true })).toHaveCount(0);
    const semanticOption = page.getByRole("option", { name: "sunset|beach", exact: true });
    await expect(semanticOption.locator(".panel-search-history-advanced")).toHaveText("*");
    await bar.press("ArrowDown");
    await bar.press("ArrowDown");
    await bar.press("Enter");
    await expect(bar).toBeFocused();
    const afterKeyboardSelection = await read("semantic");
    expect(afterKeyboardSelection.map((entry: any) => entry.text)).toEqual([
      "sunset|beach",
      "forest",
    ]);
    expect(afterKeyboardSelection[0].configuration.options.negativePrompts).toBe("crowd\ncity");
    expect((await read("text"))[0].text).toBe("alpha beta");
    await expect(bar).toHaveValue("sunset|beach");
    expect(await page.evaluate(() => (window as any).searchSnapshot)).toMatchObject({
      mode: "semantic",
      query: "sunset\nbeach",
      threshold: 0.321,
      advanced: {
        negativePrompts: "crowd\ncity",
        excludedText: "",
        caseSensitive: false,
        minDuration: "",
        maxDuration: "",
      },
    });
    await advanced.click();
    await expect(dialog.getByLabel("反向描述", { exact: true })).toHaveValue("crowd\ncity");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await bar.fill("");
    await page.locator(".panel-search-mode").click();
    await page.getByRole("menuitemcheckbox", { name: "过滤", exact: true }).click();
    await bar.focus();
    await bar.fill("alpha");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByRole("option", { name: "alpha beta", exact: true }).click();
    expect(await page.evaluate(() => (window as any).searchSnapshot.mode)).toBe("highlight");
  });
}
