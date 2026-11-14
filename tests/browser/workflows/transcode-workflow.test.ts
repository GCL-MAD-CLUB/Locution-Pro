import { test, expect, openImport } from "../support/fixtures";
import type { Page } from "@playwright/test";

function workspaceButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "工作区", exact: true })
    .getByRole("button", { name, exact: true });
}

/** Imports clip.MP4 with the default “在转码页面打开导入素材” setting. */
async function importIntoTranscode(page: Page) {
  await page.evaluate(() => {
    delete (window as any).__nativeTest.config.settings.openInTranscode;
  });
  await openImport(page);
  await expect(
    page.getByRole("checkbox", { name: "在转码页面打开导入素材", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await page.locator(".import-submit").click();
  await expect(workspaceButton(page, "转码")).toHaveAttribute("aria-current", "page");
}

function queue(page: Page) {
  return page.getByRole("grid", { name: "转码队列", exact: true });
}

test("导入素材默认进入转码队列，未选择输出位置时不能开始编码", async ({ app }) => {
  await importIntoTranscode(app);
  await expect(queue(app).getByText("clip.MP4", { exact: true })).toBeVisible();
  await expect(queue(app).getByText("未选择输出位置（必填）", { exact: true })).toBeVisible();
  await expect(queue(app).getByText("待设置", { exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "启动队列", exact: true })).toBeDisabled();
  // The embedded project media bin shows the imported file too.
  await expect(
    app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true }).first(),
  ).toBeVisible();
});

test("输出到项目媒体箱时转码完成后放入 encoder 媒体箱", async ({ app, native }) => {
  await importIntoTranscode(app);
  await queue(app).getByRole("row").filter({ hasText: "未选择输出位置" }).click();
  await app.getByRole("button", { name: "输出位置", exact: true }).click();
  await app.getByRole("option", { name: "项目媒体箱中的 encoder 文件夹", exact: true }).click();
  await expect(queue(app).getByText("C:/media/encoder/clip.mp4", { exact: true })).toBeVisible();
  await app.getByRole("button", { name: "启动队列", exact: true }).click();
  await expect(queue(app).getByText("完成", { exact: true })).toBeVisible();
  const [call] = await native.calls("transcode_media");
  expect(call.args.job).toMatchObject({
    inputPath: "C:/media/clip.MP4",
    outputDir: "C:/media/encoder",
    outputName: "clip",
    settings: { container: "mp4", video: { codec: "libx264" }, audio: { codec: "aac" } },
  });
  await expect
    .poll(async () => (await native.calls("import_media")).map((item) => item.args.path))
    .toContain("C:/media/encoder/clip.mp4");
  await expect(
    app.locator(".media-bin-panel").getByText("encoder", { exact: true }).first(),
  ).toBeVisible();
});

test("导出设置切换格式后修正编码器，字幕支持 ASS 并要求输出位置", async ({ app }) => {
  await importIntoTranscode(app);
  await queue(app).getByRole("button", { name: "MP4", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "导出设置", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确定", exact: true })).toBeDisabled();

  await dialog.getByRole("button", { name: "格式", exact: true }).click();
  const formats = app.getByRole("listbox", { name: "格式", exact: true }).getByRole("option");
  await expect(formats.nth(0)).toHaveText(/MP4/);
  await expect(formats.nth(1)).toHaveText(/MKV/);
  await app.getByRole("option", { name: "MKV (Matroska)", exact: true }).click();

  await dialog.getByRole("tab", { name: "字幕", exact: true }).click();
  await dialog.getByRole("button", { name: "字幕格式", exact: true }).click();
  await expect(app.getByRole("option", { name: "ASS (Advanced SubStation Alpha)" })).toBeVisible();
  await app.getByRole("option", { name: "ASS (Advanced SubStation Alpha)" }).click();

  await dialog.getByRole("button", { name: "输出位置", exact: true }).click();
  await app.getByRole("option", { name: "文件夹（文件管理器 / Finder）", exact: true }).click();
  await expect(dialog.getByText("C:/exports", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();

  await expect(
    queue(app).getByRole("button", { name: "MKV (Matroska)", exact: true }),
  ).toBeVisible();
  await expect(queue(app).getByText("C:/exports/clip.mkv", { exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "启动队列", exact: true })).toBeEnabled();
});

test("取消勾选在转码页面打开导入素材后导入仍回到编辑页", async ({ app }) => {
  await openImport(app);
  await expect(
    app.getByRole("checkbox", { name: "在转码页面打开导入素材", exact: true }),
  ).not.toBeChecked();
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await app.locator(".import-submit").click();
  await expect(workspaceButton(app, "编辑")).toHaveAttribute("aria-current", "page");
});

test("转码页面由独立面板组成，关闭的面板可从窗口菜单重新打开", async ({ app }) => {
  await importIntoTranscode(app);
  const tabLabel = (name: string) => app.locator(".dock-tab-label", { hasText: name }).first();
  for (const name of ["队列", "监视文件夹", "预设浏览器", "编码"]) {
    await expect(tabLabel(name)).toBeVisible();
  }

  await tabLabel("监视文件夹").click();
  await expect(app.getByRole("button", { name: "添加监视文件夹" })).toBeVisible();

  await tabLabel("监视文件夹").click({ button: "right" });
  await app.getByRole("menuitem", { name: "关闭面板", exact: true }).click();
  await expect(app.locator(".dock-tab-label", { hasText: "监视文件夹" })).toHaveCount(0);

  await app.getByRole("button", { name: "窗口(W)", exact: true }).click();
  await app.getByRole("menuitem", { name: "转码", exact: true }).click();
  await app.getByRole("menuitemcheckbox", { name: "监视文件夹", exact: true }).click();
  await expect(tabLabel("监视文件夹")).toBeVisible();
});

test("导出设置可预览源与输出画面，并可按实际编码画质对比", async ({ app, native }) => {
  await importIntoTranscode(app);
  await queue(app).getByRole("button", { name: "MP4", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "导出设置", exact: true });
  const preview = dialog.getByRole("region", { name: "预览", exact: true });
  await expect(preview.getByRole("tab", { name: "分屏对比", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(preview.getByRole("img", { name: "输出画面" })).toBeVisible();
  await expect(preview.getByRole("slider", { name: "对比分界" })).toBeVisible();
  await expect
    .poll(async () => (await native.calls("transcode_preview_frames")).length)
    .toBeGreaterThan(0);
  const [first] = await native.calls("transcode_preview_frames");
  expect(first.args.request).toMatchObject({
    inputPath: "C:/media/clip.MP4",
    timeUs: 5_000_000,
    encoded: false,
    settings: { container: "mp4" },
  });

  // The editing page's timeline drives the preview time and the source range.
  await expect(preview.locator(".monitor-time")).toHaveText("00:00:05:00");
  await preview.getByTitle("下一帧", { exact: true }).click();
  await expect(preview.locator(".monitor-time")).toHaveText("00:00:05:01");
  await expect
    .poll(async () =>
      (await native.calls("transcode_preview_frames")).some(
        (call) => call.args.request.timeUs === 5_041_667,
      ),
    )
    .toBe(true);
  await preview.getByRole("button", { name: "设为入点", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "入点", exact: true })).toHaveValue(
    "00:00:05.042",
  );
  await expect(preview.locator(".timeline-cue-range")).toBeVisible();
  await preview.getByRole("button", { name: "清除范围", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "入点", exact: true })).toHaveValue("");

  await preview.getByRole("tab", { name: "并排", exact: true }).click();
  await expect(preview.getByRole("img", { name: "源画面" })).toBeVisible();
  await expect(preview.getByRole("img", { name: "输出画面" })).toBeVisible();

  await preview.getByRole("checkbox", { name: "按实际编码画质" }).check();
  await expect
    .poll(async () =>
      (await native.calls("transcode_preview_frames")).some((call) => call.args.request.encoded),
    )
    .toBe(true);
});
