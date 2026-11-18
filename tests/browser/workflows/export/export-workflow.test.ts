import { test, expect, openImport } from "../../support/fixtures";

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
      window.__nativeTest.existingFiles = true;
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
    window.__nativeTest.existingFiles = true;
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
    window.__nativeTest.existingPaths = ["C:/exports/clip.MP4.mp4"];
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

test("转码默认隐藏，Beta 开关保存后仍需重启才能使用", async ({ app, native }) => {
  await prepareExport(app);
  const workspace = app.getByRole("navigation", { name: "工作区", exact: true });
  await expect(workspace.getByRole("button", { name: "转码", exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "发送到转码", exact: true })).toHaveCount(0);
  await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
  const toggle = app.getByRole("menuitemcheckbox", { name: "重启以使用转码（Beta）", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect.poll(async () => (await native.calls("update_preferences")).length).toBe(1);
  const [saved] = await native.calls("update_preferences");
  expect(saved.args.preferences.beta_transcode_enabled).toBe(true);
  const restart = app.getByRole("dialog", { name: "重启软件", exact: true });
  await expect(restart.getByRole("button", { name: "保存后重启", exact: true })).toBeVisible();
  await restart.getByRole("button", { name: "稍后", exact: true }).click();
  await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(workspace.getByRole("button", { name: "转码", exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "发送到转码", exact: true })).toHaveCount(0);
});

test.describe("Beta 转码", () => {
  test.use({ betaTranscode: true });
  test("取消勾选已启用的转码也提示重启，稍后仍可使用", async ({ app, native }) => {
    await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
    const toggle = app.getByRole("menuitemcheckbox", { name: "使用转码（Beta）", exact: true });
    await toggle.click();
    const restart = app.getByRole("dialog", { name: "重启软件", exact: true });
    await expect(
      restart.getByRole("heading", { name: "关闭转码（Beta）", exact: true }),
    ).toBeVisible();
    await expect(restart.getByRole("button", { name: "立即重启", exact: true })).toBeVisible();
    const [saved] = await native.calls("update_preferences");
    expect(saved.args.preferences.beta_transcode_enabled).toBe(false);
    await restart.getByRole("button", { name: "稍后", exact: true }).click();
    expect(await native.calls("restart_application")).toHaveLength(0);
    await expect(
      app
        .getByRole("navigation", { name: "工作区", exact: true })
        .getByRole("button", { name: "转码", exact: true }),
    ).toBeVisible();
    await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
    await expect(toggle).not.toBeChecked();
  });
  test("发送到转码把片段按导出设置加入转码队列并切到转码页", async ({ app, native }) => {
    await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
    await expect(
      app.getByRole("menuitemcheckbox", { name: "使用转码（Beta）", exact: true }),
    ).toBeChecked();
    await app.keyboard.press("Escape");
    await prepareExport(app);
    await app
      .locator(".export-action-bar")
      .getByRole("button", { name: "发送到转码", exact: true })
      .click();
    await expect(
      app
        .getByRole("navigation", { name: "工作区", exact: true })
        .getByRole("button", { name: "转码", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(app.getByText("已将 1 个片段发送到转码队列。", { exact: true })).toBeVisible();
    const queue = app.locator(".transcode-queue");
    await expect(queue.getByText("clip.MP4").first()).toBeVisible();
    await expect(queue.getByText("导出设置 · H.264").first()).toBeVisible();
    expect(await native.calls("export_clips")).toHaveLength(0);
  });
});

test("没有项目更改时可以立即重启以启用 Beta 转码", async ({ app, native }) => {
  await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
  await app.getByRole("menuitemcheckbox", { name: "重启以使用转码（Beta）", exact: true }).click();
  const restart = app.getByRole("dialog", { name: "重启软件", exact: true });
  await restart.getByRole("button", { name: "立即重启", exact: true }).click();
  await expect.poll(async () => (await native.calls("restart_application")).length).toBe(1);
  expect(await native.calls("save_project_file")).toHaveLength(0);
});

test("有未保存更改时先完成保存才重启", async ({ app, native }) => {
  await prepareExport(app);
  await native.hold("save_project_file");
  await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
  await app.getByRole("menuitemcheckbox", { name: "重启以使用转码（Beta）", exact: true }).click();
  const restart = app.getByRole("dialog", { name: "重启软件", exact: true });
  await restart.getByRole("button", { name: "保存后重启", exact: true }).click();
  await expect.poll(async () => (await native.calls("save_project_file")).length).toBe(1);
  expect(await native.calls("restart_application")).toHaveLength(0);
  await native.release("save_project_file");
  await expect.poll(async () => (await native.calls("restart_application")).length).toBe(1);
});

test("保存项目失败时不重启", async ({ app, native }) => {
  await prepareExport(app);
  await native.fail("save_project_file", "Cannot save project");
  await app.getByRole("button", { name: "Beta版(B)", exact: true }).click();
  await app.getByRole("menuitemcheckbox", { name: "重启以使用转码（Beta）", exact: true }).click();
  const restart = app.getByRole("dialog", { name: "重启软件", exact: true });
  await restart.getByRole("button", { name: "保存后重启", exact: true }).click();
  await expect(app.getByRole("dialog", { name: /^无法保存项目/ })).toBeVisible();
  expect(await native.calls("restart_application")).toHaveLength(0);
});
