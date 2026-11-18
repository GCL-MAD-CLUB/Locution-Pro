import { test, expect } from "../../support/fixtures";

async function openPreferences(page: import("@playwright/test").Page, category: string) {
  await page.getByRole("button", { name: "编辑(E)", exact: true }).click();
  await page.getByRole("menuitem", { name: "首选项(N)", exact: true }).click();
  await page
    .getByRole("menu", { name: "首选项(N)", exact: true })
    .getByRole("menuitem", { name: new RegExp(`^${category}\\(`) })
    .click();
  return page.locator(".preferences-dialog");
}

const appearancePreferences = (page: import("@playwright/test").Page) =>
  openPreferences(page, "外观");

test("首选项子菜单逐项打开同一弹窗的对应子页，并重新初始化草稿", async ({ app, native }) => {
  for (const category of ["常规", "外观", "自动保存", "媒体缓存", "媒体工具"]) {
    const dialog = await openPreferences(app, category);
    await expect(dialog).toHaveCount(1);
    await expect(app.getByRole("menu")).toHaveCount(0);
    await expect(dialog.getByRole("tab", { name: category, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByRole("tab", { name: category, exact: true })).toBeFocused();
    await expect(dialog.getByRole("tabpanel", { name: category, exact: true })).toBeVisible();
    await expect(dialog.getByRole("tab")).toHaveCount(5);
    if (category === "常规")
      await dialog.getByRole("checkbox", { name: "启动时显示主页", exact: true }).check();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const dialog = await openPreferences(app, "常规");
  await expect(
    dialog.getByRole("checkbox", { name: "启动时显示主页", exact: true }),
  ).not.toBeChecked();
  await app.keyboard.press("Escape");
  expect(await native.calls("update_preferences")).toHaveLength(0);
});

test("首选项支持助记键，子菜单打开后不触发编辑菜单的同名助记键", async ({ app, native }) => {
  await app.getByRole("button", { name: "编辑(E)", exact: true }).click();
  await app.keyboard.press("n");
  const submenu = app.getByRole("menu", { name: "首选项(N)", exact: true });
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitem")).toHaveText([
    "常规(G)...",
    "外观(P)...",
    "自动保存(U)...",
    "媒体缓存(C)...",
    "媒体工具(T)...",
  ]);
  await expect(app.locator(".preferences-dialog")).toHaveCount(0);
  await app.keyboard.press("p");
  const dialog = app.locator(".preferences-dialog");
  await expect(dialog.getByRole("tab", { name: "外观", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await app.keyboard.press("Escape");
  await app.getByRole("button", { name: "编辑(E)", exact: true }).click();
  await expect(submenu).toHaveCount(0);
  await app.keyboard.press("n");
  await expect(submenu).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(app.getByRole("menu")).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(await native.calls("update_preferences")).toHaveLength(0);
});

test("外观提供三种缩略图，键盘即时预览，取消和 Esc 恢复已保存外观", async ({ app, native }) => {
  const dialog = await appearancePreferences(app);
  const group = dialog.getByRole("radiogroup", { name: "颜色主题" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { name: "最暗", exact: true })).toBeChecked();
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

test("保存外观后全局切换，重新打开首选项保留已保存值", async ({ app, native }) => {
  for (const [value, name] of [
    ["dark", "深色"],
    ["light", "浅色"],
    ["darkest", "最暗"],
  ]) {
    const dialog = await appearancePreferences(app);
    await dialog.getByRole("radio", { name, exact: true }).click();
    await expect(app.locator("html")).toHaveAttribute("data-theme", value);
    await dialog.getByRole("button", { name: "确定", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(app.locator("html")).toHaveAttribute("data-theme", value);
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
      const preferences = window.__nativeTest.preferences;
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
  return openPreferences(page, "自动保存");
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
