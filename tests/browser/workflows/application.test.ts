import type { Locator } from "@playwright/test";

import packageJson from "../../../package.json" with { type: "json" };
import { test, expect, openImport } from "../support/fixtures";

const prerelease = packageJson.version.includes("-");

async function assertUpdateVisualAlignment(dialog: Locator) {
  const alignment = await dialog.locator(".update-dialog-status").evaluate((row) => {
    const visual = row.querySelector(".update-dialog-visual");
    const text = visual?.nextElementSibling;
    if (!(visual instanceof Element) || !(text instanceof Element)) {
      return { visualWidth: 0, textOffset: 0 };
    }
    const visualBox = visual.getBoundingClientRect();
    const textBox = text.getBoundingClientRect();
    return { visualWidth: visualBox.width, textOffset: textBox.left - visualBox.right };
  });
  expect(alignment.visualWidth).toBe(48);
  expect(alignment.textOffset).toBeCloseTo(16, 1);
}

test("启动时先展示安装错误，再展示新版本说明，确认后不重复", async ({ page, native }) => {
  await page.addInitScript(() => {
    (window as any).__nativeTest.updateStartup = {
      pending: null,
      ignored: false,
      ignoredVersions: [],
      failure: { version: "0.5.0", error: "Dependency hash mismatch: runtime.dll", exitCode: 2 },
      notes: {
        version: "0.4.1",
        title: "Locution Pro 0.4.1",
        body: "## 更新说明\n- 新版功能",
        url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/tag/v0.4.1",
      },
    };
  });
  await page.goto("/");
  const failed = page.getByRole("dialog", { name: "更新失败", exact: true });
  await expect(failed.getByText("Dependency hash mismatch: runtime.dll")).toBeVisible();
  await expect(failed.getByRole("button", { name: "前往发布页下载" })).toBeVisible();
  await failed
    .locator(".modal-dialog-actions")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const installed = page.getByRole("dialog", { name: "版本更新", exact: true });
  await expect(installed.getByText("已更新", { exact: true })).toBeVisible();
  await expect(installed.getByRole("heading", { name: "更新说明" })).toBeVisible();
  await expect.poll(async () => (await native.calls("acknowledge_update_notes")).length).toBe(1);
  await installed.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.describe("正式版更新", () => {
  test.skip(prerelease, "预发布版本不检查正式版更新");
  test("自动更新不可用时展示发布说明和原有发布页入口", async ({ page, native }) => {
    await page.addInitScript(() => {
      (window as any).__nativeTest.failures.download_update = "No updater in legacy release";
      (window as any).__nativeTest.expectedFailures.push("tauri:download_update");
      (window as any).__nativeTest.latestRelease = {
        version: "v999.0.0",
        title: "Locution Pro 999.0.0",
        body: "## 本次更新\n- 更快的媒体导入\n- [完整说明](https://example.com/notes)",
        url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/tag/v999.0.0",
      };
    });
    await page.goto("/");

    const update = page.getByRole("dialog", { name: "检查更新", exact: true });
    await expect(update).toBeVisible();
    await expect(update.getByRole("heading", { name: "Locution Pro 999.0.0" })).toBeVisible();
    await expect(update.locator(".update-dialog-summary-icon")).toBeVisible();
    await expect(update.getByText("新版本", { exact: true })).toBeVisible();
    const badgeOffset = await update.locator(".update-dialog-title-row").evaluate((row) => {
      const title = row.querySelector("h3");
      const badge = row.querySelector(".update-dialog-badge");
      return title instanceof Element && badge instanceof Element
        ? badge.getBoundingClientRect().left - title.getBoundingClientRect().right
        : -1;
    });
    expect(badgeOffset).toBeGreaterThan(0);
    await expect(update.getByRole("heading", { name: "本次更新" })).toBeVisible();
    await expect(update.getByText("更快的媒体导入")).toBeVisible();
    expect(await native.calls("fetch_latest_release")).toHaveLength(1);

    await update.getByRole("link", { name: "完整说明" }).click();
    expect(await native.calls("open_external_url")).toEqual([
      { command: "open_external_url", args: { url: "https://example.com/notes" } },
    ]);
    await update.getByRole("button", { name: "前往发布页" }).click();
    expect((await native.calls("open_external_url"))[1].args.url).toBe(
      "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/tag/v999.0.0",
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

  test("更新包就绪使用12px字号，忽略选项位于版本说明与按钮之间", async ({ page, native }) => {
    await page.addInitScript(() => {
      (window as any).__nativeTest.latestRelease = {
        version: "999.0.0",
        title: "Locution Pro 999.0.0",
        body: "## 更新内容\n- 改进更新体验",
        url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/tag/v999.0.0",
      };
    });
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "检查更新", exact: true });
    await expect(dialog.getByRole("button", { name: "立即更新", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "前往发布页", exact: true })).toHaveCount(0);
    for (const selector of [
      ".update-dialog-body",
      "h3",
      ".update-dialog-notes h2",
      ".update-dialog-ignore",
      ".modal-dialog-confirm",
    ]) {
      await expect(dialog.locator(selector).first()).toHaveCSS("font-size", "12px");
    }
    const positions = await dialog.evaluate((element) => ({
      notes: element.querySelector(".update-dialog-notes")!.getBoundingClientRect().bottom,
      ignoreTop: element.querySelector(".update-dialog-ignore")!.getBoundingClientRect().top,
      ignoreBottom: element.querySelector(".update-dialog-ignore")!.getBoundingClientRect().bottom,
      actions: element.querySelector(".modal-dialog-actions")!.getBoundingClientRect().top,
    }));
    expect(positions.ignoreTop).toBeGreaterThan(positions.notes);
    expect(positions.ignoreBottom).toBeLessThan(positions.actions);
    await dialog.getByRole("checkbox", { name: "不再提示此版本" }).check();
    expect(await native.calls("set_update_ignored")).toHaveLength(1);
  });

  test("更新包无法启动时回退发布页，继续保留当前应用", async ({ page, native }) => {
    await page.addInitScript(() => {
      const state = (window as any).__nativeTest;
      state.latestRelease = {
        version: "999.0.0",
        title: "New release",
        body: "Release notes",
        url: "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/tag/v999.0.0",
      };
      state.failures.install_update = "Cached installer is unavailable";
      state.expectedFailures.push("tauri:install_update");
    });
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "检查更新", exact: true });
    await dialog.getByRole("button", { name: "立即更新", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "前往发布页", exact: true })).toBeVisible();
    await expect(dialog.getByText("Release notes", { exact: true })).toBeVisible();
    await expect(page.getByText("暂时无法检查更新")).toHaveCount(0);
    expect(await native.calls("install_update")).toHaveLength(1);
    await dialog.getByRole("button", { name: "前往发布页", exact: true }).click();
    expect((await native.calls("open_external_url"))[0].args.url).toContain("v999.0.0");
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
    await assertUpdateVisualAlignment(latest);
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
    await expect(checking).toHaveCount(0);
    expect(await native.calls("fetch_latest_release")).toHaveLength(2);
    await app.getByRole("button", { name: "帮助(H)", exact: true }).click();
    await expect(app.getByRole("menuitem", { name: "更新(U)...", exact: true })).toBeDisabled();
    expect(await native.calls("fetch_latest_release")).toHaveLength(2);
    await app.keyboard.press("Escape");
    await native.release("fetch_latest_release");
    await expect(checking.getByText("当前已是最新版本")).toBeVisible();
  });
});

test("预发布版本启动和手动检查均不请求正式版更新", async ({ app, native }) => {
  test.skip(!prerelease, "仅适用于预发布版本");
  await expect.poll(async () => (await native.calls("update_startup")).length).toBe(1);
  expect(await native.calls("fetch_latest_release")).toHaveLength(0);
  await app.getByRole("button", { name: "帮助(H)", exact: true }).click();
  await app.getByRole("menuitem", { name: "更新(U)...", exact: true }).click();
  const latest = app.getByRole("dialog", { name: "检查更新", exact: true });
  await expect(latest.getByText("当前已是最新版本")).toBeVisible();
  expect(await native.calls("fetch_latest_release")).toHaveLength(0);
  expect(await native.calls("download_update")).toHaveLength(0);
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
