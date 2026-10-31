import { test, expect } from "../support/fixtures";

async function appearancePreferences(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "编辑(E)", exact: true }).click();
  await page.getByRole("menuitem", { name: /首选项/ }).click();
  await page.getByRole("tab", { name: "外观", exact: true }).click();
  return page.locator(".preferences-dialog");
}

test("外观提供三种缩略图，键盘即时预览，取消和 Esc 恢复已保存外观", async ({ app, native }) => {
  const dialog = await appearancePreferences(app);
  const group = dialog.getByRole("radiogroup", { name: "颜色主题" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { name: "最暗", exact: true })).toBeChecked();
  await expect(group.locator("svg")).toHaveCount(3);
  await group.getByRole("radio", { name: "最暗", exact: true }).focus();
  await app.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "深色", exact: true })).toBeChecked();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await app.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "浅色", exact: true })).toBeFocused();
  await expect(group.getByRole("radio", { name: "浅色", exact: true })).toBeChecked();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "darkest");
  expect(await native.calls("update_preferences")).toHaveLength(0);
  await appearancePreferences(app);
  await expect(dialog.getByRole("radio", { name: "最暗", exact: true })).toBeChecked();
  await dialog.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await app.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(app.locator("html")).toHaveAttribute("data-theme", "darkest");
});

test("保存外观后全局切换，三套主题的正文、菜单、输入框和选中行保持可读", async ({
  app,
  native,
}) => {
  for (const [value, name, background] of [
    ["dark", "深色", "rgb(50, 50, 50)"],
    ["light", "浅色", "rgb(248, 248, 248)"],
    ["darkest", "最暗", "rgb(29, 29, 29)"],
  ]) {
    const dialog = await appearancePreferences(app);
    await dialog.getByRole("radio", { name, exact: true }).click();
    await expect(app.locator("html")).toHaveAttribute("data-theme", value);
    await dialog.getByRole("button", { name: "确定", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(app.locator("html")).toHaveAttribute("data-theme", value);
    await expect(app.locator("body")).toHaveCSS("background-color", background);
    await expect(app.locator(".secondary-topbar")).toHaveCSS("background-color", background);
    const ratios = await app.evaluate(() => {
      const probe = document.createElement("span");
      document.body.append(probe);
      function luminance(token: string) {
        probe.style.color = `var(${token})`;
        const channels = getComputedStyle(probe)
          .color.match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      try {
        return [
          ["--color-text", "--color-surface-canvas"],
          ["--color-menu-text", "--color-menu-background"],
          ["--color-text-field", "--color-surface-input-inset"],
          ["--color-text-table-row", "--color-surface-row-selected"],
          ["--color-dialog-header-text", "--color-dialog-header"],
        ].map(([foreground, background]) => {
          const a = luminance(foreground),
            b = luminance(background);
          return { foreground, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
      } finally {
        probe.remove();
      }
    });
    for (const pair of ratios)
      expect(pair.ratio, `${value}: ${pair.foreground}`).toBeGreaterThanOrEqual(4.5);
    await appearancePreferences(app);
    await expect(dialog.getByRole("radio", { name, exact: true })).toBeChecked();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }
  const calls = await native.calls("update_preferences");
  expect(calls.map((call) => call.args.preferences.appearance)).toEqual([
    "dark",
    "light",
    "darkest",
  ]);
});

test("外观保存失败保留预览和草稿，重试期间冻结选项，成功后持久保存", async ({ app, native }) => {
  const dialog = await appearancePreferences(app);
  await dialog.getByRole("radio", { name: "浅色", exact: true }).click();
  await native.fail("update_preferences", "测试外观保存失败");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(app.locator(".error-dialog")).toBeVisible();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await app.locator(".error-dialog").getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "浅色", exact: true })).toBeChecked();
  await native.fail("update_preferences");
  await native.hold("update_preferences");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  for (const radio of await dialog.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await native.release("update_preferences");
  await expect(dialog).toHaveCount(0);
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
});

for (const appearance of ["dark", "light", "legacy"] as const) {
  test(`启动时恢复外观：${appearance}`, async ({ page, native }) => {
    await page.goto("/tests/browser/support/blank.html");
    await page.evaluate(async (appearance) => {
      const preferences = (window as any).__nativeTest.preferences;
      if (appearance === "legacy") delete preferences.appearance;
      else preferences.appearance = appearance;
      const root = document.createElement("div");
      root.id = "root";
      document.body.append(root);
      const entry = "/src/main.tsx";
      await import(/* @vite-ignore */ entry);
    }, appearance);
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      appearance === "legacy" ? "darkest" : appearance,
    );
    expect(await native.calls("update_preferences")).toHaveLength(0);
  });
}

async function preferences(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "编辑(E)", exact: true }).click();
  await page.getByRole("menuitem", { name: /首选项/ }).click();
  await page.getByRole("tab", { name: "自动保存", exact: true }).click();
  return page.locator(".preferences-dialog");
}

test("首选项取消不保存，再次打开恢复已保存值", async ({ app, native }) => {
  const dialog = await preferences(app);
  await dialog.getByRole("checkbox", { name: "自动保存项目", exact: true }).check();
  await dialog.getByRole("spinbutton", { name: "自动保存时间间隔" }).fill("11");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await native.calls("update_preferences")).toHaveLength(0);
  await preferences(app);
  await expect(
    dialog.getByRole("checkbox", { name: "自动保存项目", exact: true }),
  ).not.toBeChecked();
  await expect(dialog.getByRole("spinbutton", { name: "自动保存时间间隔" })).toHaveValue("5");
});

test("自动保存拒绝无效间隔，保存后再次打开保留设置", async ({ app, native }) => {
  const dialog = await preferences(app);
  await dialog.getByRole("checkbox", { name: "自动保存项目", exact: true }).check();
  const interval = dialog.getByRole("spinbutton", { name: "自动保存时间间隔" });
  for (const invalid of ["0", "1441", "1.5", ""]) {
    await interval.fill(invalid);
    await expect(dialog.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  }
  await interval.fill("11");
  await dialog.getByRole("checkbox", { name: "自动保存也会保存当前项目", exact: true }).check();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const [call] = await native.calls("update_preferences");
  expect(call.args.preferences.auto_save_interval_minutes).toBe(11);
  expect(call.args.preferences.auto_save_current_project).toBe(true);
  await preferences(app);
  await expect(interval).toHaveValue("11");
});

test("首选项保存失败保持输入并允许重试", async ({ app, native }) => {
  const dialog = await preferences(app);
  await dialog.getByRole("checkbox", { name: "自动保存项目", exact: true }).check();
  await dialog.getByRole("spinbutton", { name: "自动保存时间间隔" }).fill("8");
  await native.fail("update_preferences", "测试写入失败");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(app.getByRole("heading", { name: "无法保存首选项", exact: true })).toBeVisible();
  await app.locator(".error-dialog").getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog.getByRole("spinbutton", { name: "自动保存时间间隔" })).toHaveValue("8");
  await native.fail("update_preferences");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await native.calls("update_preferences")).toHaveLength(2);
});
