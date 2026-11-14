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
