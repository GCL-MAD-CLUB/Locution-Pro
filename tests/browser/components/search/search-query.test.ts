import { test, expect } from "../../support/fixtures";
import { SearchPanel } from "../../support/search-panel";

for (const label of ["字幕", "分镜"] as const) {
  test(`${label}搜索栏与高级搜索双向转换空白和语义分隔符`, async ({ page }) => {
    const search = new SearchPanel(page, label);
    await search.mount();
    const bar = page.getByRole("combobox");
    const entry = page.getByRole("button", { name: `${label}高级搜索` });
    const dialog = page.getByRole("dialog");
    await bar.fill("alpha  ");
    await bar.pressSequentially("beta");
    await expect(bar).toHaveValue("alpha  beta");
    await entry.click();
    await expect(dialog.getByLabel("搜索内容", { exact: true })).toHaveValue("alpha\nbeta");
    await dialog
      .getByLabel("搜索内容", { exact: true })
      .fill("  alpha\n\n beta\t gamma\u3000delta  ");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(bar).toHaveValue("alpha beta gamma delta");
    expect(await page.evaluate(() => (window as any).searchSnapshot.query)).toBe(
      "alpha beta gamma delta",
    );
    await entry.click();
    await expect(dialog.getByLabel("搜索内容", { exact: true })).toHaveValue(
      "alpha\nbeta\ngamma\ndelta",
    );
    await dialog.getByRole("button", { name: "搜索模式", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "高亮", exact: true }).click();
    await dialog.getByLabel("搜索内容", { exact: true }).fill("red\n\n green\t blue");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(bar).toHaveValue("red green blue");
    await entry.click();
    await expect(dialog.getByLabel("搜索内容", { exact: true })).toHaveValue("red\ngreen\nblue");
    await dialog.getByRole("button", { name: "搜索模式", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "语义", exact: true }).click();
    await dialog.getByLabel("正向描述", { exact: true }).fill("a sunny beach\n\n a moonlit city ");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(bar).toHaveValue("a sunny beach|a moonlit city");
    await entry.click();
    await expect(dialog.getByLabel("正向描述", { exact: true })).toHaveValue(
      "a sunny beach\na moonlit city",
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await bar.fill("a sunny beach | ");
    await bar.pressSequentially("another city");
    await expect(bar).toHaveValue("a sunny beach | another city");
    await entry.click();
    await expect(dialog.getByLabel("正向描述", { exact: true })).toHaveValue(
      "a sunny beach\nanother city",
    );
    const history = await page.evaluate(
      (kind) =>
        JSON.parse(localStorage.getItem(`locution-pro:search-history:${kind}:semantic`) ?? "[]"),
      label === "字幕" ? "subtitle" : "storyboard",
    );
    expect(history[0].text).toBe("a sunny beach|another city");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await bar.fill("sunset || | city | ");
    await entry.click();
    await expect(dialog.getByLabel("正向描述", { exact: true })).toHaveValue("sunset\ncity");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect(bar).toHaveValue("sunset|city");
    await bar.fill("ocean");
    await entry.click();
    await expect(dialog.getByLabel("正向描述", { exact: true })).toHaveValue("ocean");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await bar.fill("");
    expect(await page.evaluate(() => (window as any).searchSnapshot.query)).toBe("");
  });
}
