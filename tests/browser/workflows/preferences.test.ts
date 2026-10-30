import { test, expect } from "../support/fixtures";

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
