import { test, expect } from "../../support/fixtures";

test("深色主题保留菜单、表格、复选框和 SVG 标记的原有颜色", async ({ page }) => {
  await page.goto("/tests/browser/support/blank.html");
  await page.evaluate(async () => {
    for (const url of [
      "/src/components/common/PopupMenu/PopupMenu.css",
      "/src/components/common/PanelSearch/AdvancedSearchDialog.css",
      "/src/components/panels/ImportWorkspace/ImportWorkspace.css",
      "/src/components/panels/SubtitlePanel/SubtitlePanel.css",
    ]) {
      await import(/* @vite-ignore */ url);
    }
    document.body.innerHTML = `
      <div class="application-menubar" data-testid="menubar">菜单</div>
      <div class="popup-menu" data-testid="menu"><button class="popup-menu-item">操作</button></div>
      <div class="import-workspace"><div class="popup-menu import-popup is-dark" data-testid="import-menu">操作</div></div>
      <label class="advanced-search-check"><input type="checkbox" checked aria-label="主题复选框"></label>
      <div class="cue-row is-selected" data-testid="selected">选中行</div>
      <div class="cue-row is-primary" data-testid="primary">主选行</div>
      <span class="cue-thumbnail-flag is-excluded" data-testid="flag"></span>`;
  });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(29, 29, 29)");
  await expect(page.getByTestId("menubar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.getByTestId("menubar")).toHaveCSS("color", "rgb(32, 32, 32)");
  await expect(page.getByTestId("menu")).toHaveCSS("border-top-color", "rgb(229, 229, 229)");
  await expect(page.getByTestId("import-menu")).toHaveCSS("background-color", "rgb(11, 11, 11)");
  await expect(page.getByTestId("import-menu")).toHaveCSS("color", "rgb(197, 197, 197)");
  await expect(page.getByLabel("主题复选框")).toHaveCSS("background-color", "rgb(176, 176, 176)");
  await expect(page.getByTestId("selected")).toHaveCSS("background-color", "rgb(47, 47, 47)");
  await expect(page.getByTestId("primary")).toHaveCSS("background-color", "rgb(58, 58, 58)");
  for (const [selector, pseudo] of [
    ["input", null],
    ['[data-testid="flag"]', "::after"],
  ] as const) {
    const image = await page
      .locator(selector)
      .evaluate((node, pseudo) => getComputedStyle(node, pseudo).backgroundImage, pseudo);
    const svg = decodeURIComponent(image.match(/data:image\/svg\+xml,([^"]+)/)![1]);
    expect(svg).toContain("stroke='#1d1d1d'");
    expect(svg).not.toContain("var(");
  }
});

test("语义颜色可独立替换，菜单、正文和独立 SVG 都读取当前主题", async ({ page }) => {
  await page.goto("/tests/browser/support/blank.html");
  const result = await page.evaluate(async () => {
    const menuCss = "/src/components/common/PopupMenu/PopupMenu.css";
    const themeModule = "/src/runtime/theme.ts";
    const cursorModule = "/src/components/common/utils/sprayToolModifiers.ts";
    await import(/* @vite-ignore */ menuCss);
    const theme = await import(/* @vite-ignore */ themeModule);
    const cursors = await import(/* @vite-ignore */ cursorModule);
    document.body.innerHTML =
      '<div class="popup-menu">菜单</div><div class="panel">面板</div><span data-testid="folder">文件夹</span><select aria-label="主题原生控件"><option>选项</option></select>';
    document.querySelector<HTMLElement>('[data-testid="folder"]')!.style.background =
      theme.mediaDisplayColor("#596b91");
    const style = document.documentElement.style;
    style.setProperty("--color-surface-canvas", "rgb(250 250 250)");
    style.setProperty("--color-text-default", "rgb(40 40 40)");
    style.setProperty("--color-menu-background", "rgb(240 242 244)");
    style.setProperty("--color-menu-text", "rgb(20 22 24)");
    style.setProperty("--color-icon-cutout", "rgb(10 20 30)");
    style.setProperty("--color-spray-tool-outline", "rgb(45 55 65)");
    style.setProperty("--color-media-folder", "rgb(70 80 90)");
    style.setProperty("--theme-color-scheme", "light");
    theme.initializeThemeImages();
    return {
      image: decodeURIComponent(style.getPropertyValue("--image-checkbox-check")),
      cursor: decodeURIComponent(cursors.sprayEraserCursor()),
      savedFolderColor: theme.defaultThemeColor("--color-media-folder"),
    };
  });
  await expect(page.locator(".panel")).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await expect(page.locator(".panel")).toHaveCSS("color", "rgb(40, 40, 40)");
  await expect(page.locator(".popup-menu")).toHaveCSS("background-color", "rgb(240, 242, 244)");
  await expect(page.locator(".popup-menu")).toHaveCSS("color", "rgb(20, 22, 24)");
  await expect(page.getByTestId("folder")).toHaveCSS("background-color", "rgb(70, 80, 90)");
  await expect(page.getByLabel("主题原生控件")).toHaveCSS("color-scheme", "light");
  expect(result.image).toContain("stroke='rgb(10 20 30)'");
  expect(result.cursor).toContain('stroke="rgb(45 55 65)"');
  expect(result.cursor).not.toContain("var(");
  expect(result.savedFolderColor).toBe("#596b91");
});
