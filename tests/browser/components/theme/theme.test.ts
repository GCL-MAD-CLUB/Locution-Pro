import { test, expect } from "../../support/fixtures";

for (const appearance of ["dark", "light"] as const) {
  test(`${appearance} 的顶部、筛选、表格、输入框及按钮状态保持有效对比`, async ({ page }) => {
    await page.goto("/tests/browser/support/blank.html");
    await page.evaluate(async (appearance) => {
      for (const url of [
        "/src/components/common/SecondaryTopbar/SecondaryTopbar.css",
        "/src/components/common/WorkspaceSwitcher/WorkspaceSwitcher.css",
        "/src/components/common/TaskProgress/TaskProgress.css",
        "/src/components/common/PanelSearch/PanelSearch.css",
        "/src/components/common/SelectDropdown/SelectDropdown.css",
        "/src/components/common/ModalDialog/ModalDialog.css",
        "/src/components/common/MediaBrowserDialog/MediaBrowserDialog.css",
        "/src/components/panels/SubtitlePanel/SubtitlePanel.css",
        "/src/components/panels/StoryboardPanel/StoryboardPanel.css",
        "/src/components/panels/SourceMonitor/SourceMonitor.css",
      ])
        await import(/* @vite-ignore */ url);
      const url = "/src/runtime/theme.ts";
      const theme = await import(/* @vite-ignore */ url);
      theme.applyAppearance(appearance);
      document.body.innerHTML = `
        <main style="padding:20px">
          <header class="secondary-topbar">
            <div class="secondary-topbar-brand-copy"><strong id="brand">Locution Pro</strong><span id="tagline">对白检索与片段整理</span></div>
            <nav class="workspace-switcher"><button id="workspace">导入</button><button class="active" id="workspace-active">编辑</button></nav>
            <button class="topbar-progress-cancel" id="cancel-task">×</button>
          </header>
          <div class="panel-search-row"><button class="panel-search-dropdown"><span class="panel-search-option-label" id="option-label">模式</span><span class="panel-search-option-value" id="option-value">过滤</span></button><button class="panel-search-dropdown" disabled id="disabled-search">下一条</button></div>
          <span class="subtitle-filter-label" id="filter-label">过滤器</span>
          <div class="subtitle-filter-stars"><button id="subtitle-star">☆</button><button class="active" id="active-star">★</button></div>
          <div class="storyboard-filter-stars"><button id="storyboard-star">☆</button></div>
          <div class="subtitle-list-header" id="table-header">媒体开始</div>
          <div class="cue-row is-selected" id="selected-row">选中字幕</div>
          <div class="cue-row is-primary" id="primary-row">主选字幕</div>
          <div class="panel-search-input"><input id="field" value="字幕检索"></div>
          <div class="select-dropdown disabled"><button class="select-dropdown-trigger" id="disabled-select" disabled>不可用选项</button></div>
          <span class="monitor-time" id="timecode">00:00:12:15</span>
          <span class="panel-search-highlight" id="search-match">匹配字幕</span>
          <span class="panel-search-highlight is-focused" id="search-match-active">当前匹配</span>
          <button class="modal-dialog-confirm" id="confirm">确定</button>
          <div class="storyboard-cut-dialog"><button class="modal-dialog-confirm" id="cut-confirm">保存切点</button></div>
          <button class="accent-button" id="accent">开始</button>
          <button class="toolbar-button active" id="active-toolbar">已选择</button>
          <button class="tool-button active" id="active-tool">✓</button>
          <div class="media-browser-search"><button id="browser-action">搜索</button></div>
        </main>`;
    }, appearance);
    await page.mouse.move(1, 1);

    async function contrast(id: string, minimum: number, border = false) {
      const ratio = await page.locator(`#${id}`).evaluate((node, border) => {
        type RGB = [number, number, number];
        const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const mix = (front: number[], back: RGB, alpha = front[3] ?? 1): RGB =>
          back.map((value, index) => front[index] * alpha + value * (1 - alpha)) as RGB;
        function background(element: Element | null): RGB {
          if (!element) return [255, 255, 255];
          const style = getComputedStyle(element);
          const back = background(element.parentElement);
          return mix(mix(channels(style.backgroundColor), back), back, Number(style.opacity));
        }
        function luminance(color: RGB) {
          const linear = color.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        }
        const style = getComputedStyle(node);
        let opacity = 1;
        for (let current: Element | null = node; current; current = current.parentElement)
          opacity *= Number(getComputedStyle(current).opacity);
        const back = background(node);
        const front = mix(channels(border ? style.borderTopColor : style.color), back, opacity);
        const a = luminance(front),
          b = luminance(back);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }, border);
      expect
        .soft(ratio, `${appearance}: ${id}${border ? " border" : ""}`)
        .toBeGreaterThanOrEqual(minimum);
    }

    for (const id of [
      "brand",
      "tagline",
      "workspace",
      "workspace-active",
      "option-label",
      "option-value",
      "filter-label",
      "table-header",
      "selected-row",
      "primary-row",
      "field",
      "timecode",
      "search-match",
      "search-match-active",
      "confirm",
      "cut-confirm",
      "accent",
      "active-toolbar",
    ])
      await contrast(id, 4.5);
    for (const id of ["subtitle-star", "storyboard-star", "active-star", "active-tool"])
      await contrast(id, 3);
    for (const id of ["disabled-search", "disabled-select"]) await contrast(id, 2.5);
    await contrast("field", 3, true);
    for (const id of [
      "confirm",
      "cut-confirm",
      "accent",
      "active-toolbar",
      "browser-action",
      "cancel-task",
    ]) {
      await page.locator(`#${id}`).hover();
      await contrast(id, 4.5);
    }
    const states = await page
      .locator("#subtitle-star, #active-star, #selected-row, #primary-row")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          color: getComputedStyle(node).color,
          background: getComputedStyle(node).backgroundColor,
        })),
      );
    expect(states[0].color).not.toBe(states[1].color);
    expect(states[2].background).not.toBe(states[3].background);
    await expect(page.locator("#active-tool")).not.toHaveCSS("box-shadow", "none");
  });
}

test("品牌顶部区跟随工作区背景，菜单栏和 PopupMenu 保留固定配色", async ({ page }) => {
  await page.goto("/tests/browser/support/blank.html");
  const snapshots = await page.evaluate(async () => {
    for (const url of [
      "/src/components/common/PopupMenu/PopupMenu.css",
      "/src/components/common/SecondaryTopbar/SecondaryTopbar.css",
      "/src/components/common/ApplicationMenu/ApplicationMenu.css",
    ])
      await import(/* @vite-ignore */ url);
    const url = "/src/runtime/theme.ts";
    const theme = await import(/* @vite-ignore */ url);
    document.body.innerHTML = `
      <div class="application-menubar"><button class="application-menu-trigger active">菜单</button></div>
      <div class="secondary-topbar"><div class="secondary-topbar-brand-copy"><strong>Locution Pro</strong><span>项目</span></div><button class="tool-button active">工具</button></div>
      <div class="popup-menu"><button class="popup-menu-item" disabled>不可用</button><hr class="popup-menu-separator"></div>`;
    function snapshot() {
      return Array.from(
        document.querySelectorAll(
          ".application-menubar, .application-menubar *, .popup-menu, .popup-menu *",
        ),
        (node) => {
          const style = getComputedStyle(node);
          return [style.color, style.backgroundColor, style.borderTopColor, style.fontFamily];
        },
      );
    }
    const original = snapshot();
    const modes = [];
    const backgrounds: string[] = [];
    for (const appearance of ["dark", "light", "darkest"]) {
      theme.applyAppearance(appearance);
      modes.push(snapshot());
      backgrounds.push(
        getComputedStyle(document.querySelector(".secondary-topbar")!).backgroundColor,
      );
    }
    return { original, modes, backgrounds };
  });
  for (const snapshot of snapshots.modes) expect(snapshot).toEqual(snapshots.original);
  expect(snapshots.backgrounds).toEqual([
    "rgb(50, 50, 50)",
    "rgb(248, 248, 248)",
    "rgb(29, 29, 29)",
  ]);
});

test("即时预览重新生成 SVG 并通知喷涂工具，取消恢复后的图像也恢复", async ({ page }) => {
  await page.goto("/tests/browser/support/blank.html");
  const result = await page.evaluate(async () => {
    const themeUrl = "/src/runtime/theme.ts";
    const cursorUrl = "/src/components/common/utils/sprayToolModifiers.ts";
    const theme = await import(/* @vite-ignore */ themeUrl);
    const cursors = await import(/* @vite-ignore */ cursorUrl);
    const notifications: string[] = [];
    const unsubscribe = theme.subscribeAppearance(() =>
      notifications.push(theme.currentAppearance()),
    );
    const image = () =>
      decodeURIComponent(document.documentElement.style.getPropertyValue("--image-checkbox-check"));
    const original = image();
    const snapshots = [];
    for (const appearance of ["dark", "light", "darkest"]) {
      theme.applyAppearance(appearance);
      snapshots.push({
        image: image(),
        flag: decodeURIComponent(
          document.documentElement.style.getPropertyValue("--image-flag-excluded"),
        ),
        cursor: decodeURIComponent(cursors.sprayEraserCursor()),
      });
    }
    unsubscribe();
    theme.applyAppearance("dark");
    return { original, snapshots, notifications };
  });
  expect(result.notifications).toEqual(["dark", "light", "darkest"]);
  expect(result.snapshots[0].image).not.toBe(result.original);
  expect(result.snapshots[1].image).not.toBe(result.original);
  expect(result.snapshots[2].image).toBe(result.original);
  for (const snapshot of result.snapshots) {
    expect(snapshot.image).not.toContain("var(");
    expect(snapshot.flag).toContain("stroke='#1d1d1d'");
    expect(snapshot.cursor).not.toContain("var(");
  }
});

test("最暗主题保留菜单、表格、复选框和 SVG 标记的原有颜色", async ({ page }) => {
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

test("工作区语义颜色和 SVG 可独立替换，固定菜单保留自身配色", async ({ page }) => {
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
  await expect(page.locator(".popup-menu")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".popup-menu")).toHaveCSS("color", "rgb(32, 32, 32)");
  await expect(page.getByTestId("folder")).toHaveCSS("background-color", "rgb(70, 80, 90)");
  await expect(page.getByLabel("主题原生控件")).toHaveCSS("color-scheme", "light");
  expect(result.image).toContain("stroke='rgb(10 20 30)'");
  expect(result.cursor).toContain('stroke="rgb(45 55 65)"');
  expect(result.cursor).not.toContain("var(");
  expect(result.savedFolderColor).toBe("#596b91");
});
