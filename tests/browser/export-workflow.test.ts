import { test, expect, openImport } from "./fixtures";

async function prepareExport(page: import("@playwright/test").Page) {
  await openImport(page);
  await page.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await page.locator(".import-submit").click();
  await page
    .getByRole("table", { name: "媒体列表", exact: true })
    .getByRole("row")
    .filter({ hasText: "clip.MP4" })
    .click();
  await page.keyboard.press("Control+Shift+e");
  await expect(page.getByRole("region", { name: "导出工作区" })).toBeVisible();
  await page
    .locator(".export-settings-panel")
    .getByRole("button", { name: "选择", exact: true })
    .click();
  await expect(
    page.locator(".export-action-bar").getByRole("button", { name: "导出", exact: true }),
  ).toBeEnabled();
}

test("导出只有派发后才返回编辑页，完成后显示实际导出数量", async ({ app, native }) => {
  await prepareExport(app);
  await native.hold("export_clips");
  await app
    .locator(".export-action-bar")
    .getByRole("button", { name: "导出", exact: true })
    .click();
  await expect.poll(async () => (await native.calls("export_clips")).length).toBe(1);
  await expect(
    app
      .getByRole("navigation", { name: "工作区", exact: true })
      .getByRole("button", { name: "编辑", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const [call] = await native.calls("export_clips");
  expect(call.args.clips).toHaveLength(1);
  expect(call.args.options.outputDir).toBe("C:/exports");
  await native.release("export_clips");
  await expect(app.getByText("已导出 1 个片段。", { exact: true })).toBeVisible();
});

for (const action of ["取消", "跳过"]) {
  test(`冲突时${action}保持导出页且从不派发编码`, async ({ app, native }) => {
    await prepareExport(app);
    await app.evaluate(() => {
      (window as any).__nativeTest.existingFiles = true;
    });
    await app
      .locator(".export-action-bar")
      .getByRole("button", { name: "导出", exact: true })
      .click();
    const conflict = app.locator(".export-conflict-dialog");
    await expect(conflict).toBeVisible();
    expect(await native.calls("export_clips")).toHaveLength(0);
    await conflict.getByRole("button", { name: action, exact: true }).click();
    await expect(conflict).toHaveCount(0);
    await expect(app.getByRole("region", { name: "导出工作区" })).toBeVisible();
    await expect(
      app.locator(".export-action-bar").getByRole("button", { name: "导出", exact: true }),
    ).toBeEnabled();
    expect(await native.calls("export_clips")).toHaveLength(0);
    await expect(app.getByText("已开始导出。", { exact: true })).toHaveCount(0);
  });
}

test("冲突覆盖只派发一次，并传递用户决定", async ({ app, native }) => {
  await prepareExport(app);
  await app.evaluate(() => {
    (window as any).__nativeTest.existingFiles = true;
  });
  await app
    .locator(".export-action-bar")
    .getByRole("button", { name: "导出", exact: true })
    .click();
  await app
    .locator(".export-conflict-dialog")
    .getByRole("button", { name: "覆盖", exact: true })
    .click();
  await expect(app.getByText("已导出 1 个片段。", { exact: true })).toBeVisible();
  const calls = await native.calls("export_clips");
  expect(calls).toHaveLength(1);
  expect(calls[0].args.options.existingFileMode).toBe("overwrite");
});

test("冲突使用唯一名称不会覆盖原输出，派发采用选定的新名字", async ({ app, native }) => {
  await prepareExport(app);
  await app.evaluate(() => {
    (window as any).__nativeTest.existingPaths = ["C:/exports/clip.MP4.mp4"];
  });
  await app
    .locator(".export-action-bar")
    .getByRole("button", { name: "导出", exact: true })
    .click();
  await app
    .locator(".export-conflict-dialog")
    .getByRole("button", { name: "使用唯一名称", exact: true })
    .click();
  await expect(app.getByText("已导出 1 个片段。", { exact: true })).toBeVisible();
  const [call] = await native.calls("export_clips");
  expect(call.args.clips[0].outputName).toBe("clip.MP4-1.mp4");
  expect(call.args.options.existingFileMode).toBe("uniqueName");
});

test("导出预检查尚未完成时保持当前页面且禁用重复提交", async ({ app, native }) => {
  await prepareExport(app);
  await native.hold("path_is_file");
  await native.hold("export_clips");
  const submit = app
    .locator(".export-action-bar")
    .getByRole("button", { name: "导出", exact: true });
  await submit.click();
  await expect.poll(async () => (await native.calls("path_is_file")).length).toBe(1);
  await expect(submit).toBeDisabled();
  await expect(app.getByRole("region", { name: "导出工作区" })).toBeVisible();
  expect(await native.calls("export_clips")).toHaveLength(0);
  await native.release("path_is_file");
  await expect.poll(async () => (await native.calls("export_clips")).length).toBe(1);
  await expect(app.getByRole("region", { name: "导出工作区" })).toHaveCount(0);
  await native.release("export_clips");
  await expect(app.getByText("已导出 1 个片段。", { exact: true })).toBeVisible();
});
