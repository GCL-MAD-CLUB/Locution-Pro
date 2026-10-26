import { test, expect, openImport } from "./fixtures";

test("启动后台检查仅提示一次并展示发布说明和发布页入口", async ({ page, native }) => {
  await page.addInitScript(() => {
    (window as any).__nativeTest.latestRelease = {
      version: "v0.5.0",
      title: "Locution Pro 0.5.0",
      body: "## 本次更新\n- 更快的媒体导入\n- [完整说明](https://example.com/notes)",
      url: "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.5.0",
    };
  });
  await page.goto("/");

  const update = page.getByRole("dialog", { name: "检查更新", exact: true });
  await expect(update).toBeVisible();
  await expect(update.getByRole("heading", { name: "Locution Pro 0.5.0" })).toBeVisible();
  await expect(update.getByRole("heading", { name: "本次更新" })).toBeVisible();
  await expect(update.getByText("更快的媒体导入")).toBeVisible();
  expect(await native.calls("fetch_latest_release")).toHaveLength(1);

  await update.getByRole("link", { name: "完整说明" }).click();
  expect(await native.calls("open_external_url")).toEqual([
    { command: "open_external_url", args: { url: "https://example.com/notes" } },
  ]);
  await update.getByRole("button", { name: "前往发布页" }).click();
  expect((await native.calls("open_external_url"))[1].args.url).toBe(
    "https://github.com/GCL-MAD-CLUB/LineCut/releases/tag/v0.5.0",
  );
  await update.getByRole("button", { name: "稍后" }).click();
  await expect(update).toHaveCount(0);
  expect(await native.calls("fetch_latest_release")).toHaveLength(1);
});

test("启动检查失败保持静默", async ({ page, native }) => {
  await page.addInitScript(() => {
    const state = (window as any).__nativeTest;
    state.failures.fetch_latest_release = "offline";
    state.expectedFailures.push("tauri:fetch_latest_release");
  });
  await page.goto("/");
  await expect.poll(async () => (await native.calls("fetch_latest_release")).length).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("帮助菜单手动检查展示最新状态和失败反馈", async ({ app, native }) => {
  await expect.poll(async () => (await native.calls("fetch_latest_release")).length).toBe(1);
  await app.getByRole("button", { name: "帮助(H)", exact: true }).click();
  const items = await app.getByRole("menuitem").allTextContents();
  expect(items.indexOf("显示日志文件(L)...")).toBeLessThan(items.indexOf("更新(U)..."));
  expect(items.indexOf("更新(U)...")).toBeLessThan(items.indexOf("关于 Locution Pro(A)..."));
  await app.getByRole("menuitem", { name: "更新(U)...", exact: true }).click();
  const latest = app.getByRole("dialog", { name: "检查更新", exact: true });
  await expect(latest.getByText("当前已是最新版本")).toBeVisible();
  await latest.getByRole("button", { name: "完成" }).click();

  await native.fail("fetch_latest_release", "offline");
  await app.getByRole("button", { name: "帮助(H)", exact: true }).click();
  await app.getByRole("menuitem", { name: "更新(U)...", exact: true }).click();
  const failed = app.getByRole("dialog", { name: "检查更新失败", exact: true });
  await expect(failed.getByText("暂时无法检查更新")).toBeVisible();
  await expect(failed.getByRole("button", { name: "重试" })).toBeVisible();
});

test("手动检查期间不会派发重复请求", async ({ app, native }) => {
  await expect.poll(async () => (await native.calls("fetch_latest_release")).length).toBe(1);
  await native.hold("fetch_latest_release");
  await app.getByRole("button", { name: "帮助(H)", exact: true }).click();
  await app.getByRole("menuitem", { name: "更新(U)...", exact: true }).click();
  const checking = app.getByRole("dialog", { name: "检查更新", exact: true });
  await expect(checking.getByText("正在检查新版本")).toBeVisible();
  expect(await native.calls("fetch_latest_release")).toHaveLength(2);
  await checking.getByRole("button", { name: "取消" }).click();
  await native.release("fetch_latest_release");
  await expect(checking).toHaveCount(0);
});

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
