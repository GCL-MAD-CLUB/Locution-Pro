import { test, expect, openImport } from "./fixtures";

test("应用菜单可打开关于，两个视图均限制焦点且拦截应用快捷键", async ({ app, native }) => {
  await app.getByRole("button", { name: "帮助(H)", exact: true }).click();
  await app.getByRole("menuitem", { name: /关于 Locution Pro/ }).click();
  const about = app.getByRole("dialog", { name: "Locution Pro", exact: true });
  await expect(about).toBeVisible();
  for (const key of ["Control+s", "Control+o", "Control+n", "Enter"]) {
    await app.keyboard.press(key);
    await expect(about).toBeVisible();
  }
  expect(await native.calls("plugin:dialog|save")).toEqual([]);
  expect(await native.calls("plugin:dialog|open")).toEqual([]);
  for (const legal of [false, true]) {
    if (legal) await about.getByRole("button", { name: /法律|许可|声明/ }).click();
    for (let index = 0; index < 18; index++) {
      await app.keyboard.press(index % 2 ? "Shift+Tab" : "Tab");
      expect(await about.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
  }
  await app.mouse.click(3, 3);
  await expect(about).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
  await expect(app.getByRole("navigation", { name: "工作区", exact: true })).toBeVisible();
});

test("导入、保存、关闭及重新打开项目保留媒体且恢复最近项目", async ({ app, native }) => {
  await openImport(app);
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await app.locator(".import-submit").click();
  await expect(
    app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true }).first(),
  ).toBeVisible();
  await app.keyboard.press("Control+Shift+s");
  await expect.poll(async () => (await native.calls("save_project_file")).length).toBe(1);
  const [save] = await native.calls("save_project_file");
  expect(save.args.workspace.media_bin.items.map((item: any) => item.file_name)).toContain(
    "clip.MP4",
  );
  await app.getByRole("button", { name: "文件(F)", exact: true }).click();
  await app.getByRole("menuitem", { name: /关闭项目/ }).click();
  await expect(app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true })).toHaveCount(
    0,
  );
  await app.keyboard.press("Control+o");
  await expect(
    app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true }).first(),
  ).toBeVisible();
  expect(await native.calls("open_project_file")).toHaveLength(1);
  await app.getByRole("button", { name: "项目首页", exact: true }).click();
  await expect(
    app
      .getByRole("dialog", { name: "项目首页", exact: true })
      .getByText("回归项目", { exact: true }),
  ).toBeVisible();
});

test("关闭未保存项目可取消，明确放弃后才移除媒体", async ({ app, native }) => {
  await openImport(app);
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await app.locator(".import-submit").click();
  await expect(
    app
      .getByRole("table", { name: "媒体列表", exact: true })
      .getByText("clip.MP4", { exact: true }),
  ).toBeVisible();
  await app.keyboard.press("Control+Shift+w");
  const save = app.locator(".project-save-dialog");
  await expect(save).toBeVisible();
  await save.getByRole("button", { name: /取消/ }).click();
  expect(await native.calls("close_project")).toHaveLength(0);
  await expect(
    app
      .getByRole("table", { name: "媒体列表", exact: true })
      .getByText("clip.MP4", { exact: true }),
  ).toBeVisible();
  await app.keyboard.press("Control+Shift+w");
  await save.getByRole("button", { name: /不保存/ }).click();
  await expect(
    app
      .getByRole("table", { name: "媒体列表", exact: true })
      .getByText("clip.MP4", { exact: true }),
  ).toHaveCount(0);
  expect(await native.calls("save_project_file")).toHaveLength(0);
  expect(await native.calls("close_project")).toHaveLength(1);
});
