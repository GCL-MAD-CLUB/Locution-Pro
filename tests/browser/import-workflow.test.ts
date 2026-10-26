import { test, expect, openImport } from "./fixtures";

test("导入文件夹显示所有支持类型，过滤、搜索和视图切换保持选择", async ({ app }) => {
  await openImport(app);
  for (const name of ["nested", "clip.MP4", "take.WAV", "frame.webp", "captions.srt"])
    await expect(app.getByRole("button", { name: `选择 ${name}`, exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "选择 notes.txt", exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "选择 .hidden.mp4", exact: true })).toHaveCount(0);
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await expect(app.getByRole("status").filter({ hasText: "已选择 1 个媒体" })).toBeVisible();
  await app.getByRole("button", { name: "列表视图", exact: true }).click();
  await expect(app.getByRole("button", { name: "取消选择 clip.MP4", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await app.getByRole("textbox", { name: "搜索当前文件夹" }).fill("TAKE");
  await expect(app.getByRole("button", { name: "选择 take.WAV", exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "取消选择 clip.MP4", exact: true })).toHaveCount(0);
  await app.getByRole("button", { name: "清空搜索" }).click();
  await app.getByRole("button", { name: "文件类型", exact: true }).click();
  await app.getByRole("option", { name: "仅字幕", exact: true }).click();
  await expect(app.getByRole("button", { name: "选择 captions.srt", exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "选择 take.WAV", exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "选择 nested", exact: true })).toBeVisible();
  await expect(app.getByRole("status").filter({ hasText: "已选择 1 个媒体" })).toBeVisible();
});

test("隐藏文件按需显示，取消选择会禁用导入", async ({ app, native }) => {
  await openImport(app);
  const submit = app.locator(".import-submit");
  await expect(submit).toBeDisabled();
  await app.getByRole("button", { name: "显示隐藏文件" }).click();
  await app.getByRole("button", { name: "选择 .hidden.mp4", exact: true }).click();
  await expect(submit).toBeEnabled();
  await app.getByRole("button", { name: "取消选择 .hidden.mp4", exact: true }).click();
  await expect(submit).toBeDisabled();
  expect(await native.calls("register_import_media")).toEqual([]);
});

test("递归文件夹和单文件选择去重，导入后真实媒体箱展示结果", async ({ app, native }) => {
  await openImport(app);
  await app.getByRole("button", { name: "选择 nested", exact: true }).click();
  await expect(app.getByRole("status").filter({ hasText: "已选择 1 个媒体" })).toBeVisible();
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await expect(app.getByRole("status").filter({ hasText: "已选择 2 个媒体" })).toBeVisible();
  await app.locator(".import-submit").click();
  await expect(
    app
      .getByRole("navigation", { name: "工作区", exact: true })
      .getByRole("button", { name: "编辑", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    app.locator(".media-bin-panel").getByText("nested.mov", { exact: true }).first(),
  ).toBeVisible();
  const paths = (await native.calls("register_import_media")).map((call) => call.args.path);
  expect(paths.sort()).toEqual(["C:/media/clip.MP4", "C:/media/nested/nested.mov"]);
  await openImport(app);
  await expect(app.getByRole("button", { name: "选择 clip.MP4", exact: true })).toBeDisabled();
});

test("登记失败保留待导入文件并允许重试", async ({ app, native }) => {
  await openImport(app);
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await native.fail("register_import_media", "测试登记失败");
  await app.locator(".import-submit").click();
  await expect(app.locator(".import-selection-status")).toHaveText(
    "已导入 0 个媒体，1 个未完成，可重试。",
  );
  await expect(app.locator(".import-submit")).toBeEnabled();
  await app.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
  await native.fail("register_import_media");
  await app.locator(".import-submit").click();
  await expect(
    app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true }).first(),
  ).toBeVisible();
  expect(await native.calls("register_import_media")).toHaveLength(2);
});

test("批量导入部分失败只重试剩余文件，成功项不会重复登记", async ({ app, native }) => {
  await openImport(app);
  for (const name of ["clip.MP4", "take.WAV"])
    await app.getByRole("button", { name: `选择 ${name}`, exact: true }).click();
  await native.fail("register_import_media", "测试音频登记失败", "C:/media/take.WAV");
  await app.locator(".import-submit").click();
  await expect(app.locator(".import-selection-status")).toHaveText(
    "已导入 1 个媒体，1 个未完成，可重试。",
  );
  await app.locator(".error-dialog").getByRole("button", { name: "确定", exact: true }).click();
  await expect(app.getByRole("button", { name: "选择 clip.MP4", exact: true })).toBeDisabled();
  await expect(app.getByRole("status").filter({ hasText: "已选择 1 个媒体" })).toBeVisible();
  await native.fail("register_import_media", undefined, "C:/media/take.WAV");
  await app.locator(".import-submit").click();
  for (const name of ["clip.MP4", "take.WAV"])
    await expect(
      app.getByRole("table", { name: "媒体列表", exact: true }).getByText(name, { exact: true }),
    ).toBeVisible();
  const paths = (await native.calls("register_import_media")).map((call) => call.args.path);
  expect(paths.filter((path) => path === "C:/media/clip.MP4")).toHaveLength(1);
  expect(paths.filter((path) => path === "C:/media/take.WAV")).toHaveLength(2);
});

test("读取目录失败展示错误，恢复权限后可导航并继续选择", async ({ app, native }) => {
  await openImport(app);
  await native.fail("list_import_directory", "测试访问被拒绝");
  await app.getByRole("button", { name: "选择 nested", exact: true }).press("Enter");
  await expect(
    app.getByText("无法读取此文件夹，请检查路径和访问权限后重试。", { exact: true }),
  ).toBeVisible();
  await app.locator(".error-dialog").getByRole("button", { name: "确定", exact: true }).click();
  await native.fail("list_import_directory");
  await app
    .getByRole("navigation", { name: "文件夹路径" })
    .getByRole("button", { name: "media", exact: true })
    .click();
  await expect(app.getByRole("button", { name: "选择 clip.MP4", exact: true })).toBeVisible();
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await expect(app.locator(".import-submit")).toBeEnabled();
});

test("复制导入要求目标目录，登记使用复制后的路径及校验设置", async ({ app, native }) => {
  await openImport(app);
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await app.getByRole("switch", { name: "复制媒体", exact: true }).click();
  await expect(app.locator(".import-submit")).toBeDisabled();
  await app.getByRole("button", { name: "复制文件的目标", exact: true }).click();
  await app.getByRole("option", { name: "选择文件夹…", exact: true }).click();
  await expect(app.locator(".import-submit")).toBeEnabled();
  await app.getByRole("checkbox", { name: "添加到新媒体箱", exact: true }).check();
  await app.getByRole("textbox", { name: "名称", exact: true }).fill("回归素材");
  await app.locator(".import-submit").click();
  await expect(
    app
      .getByRole("table", { name: "媒体列表", exact: true })
      .getByText("回归素材", { exact: true }),
  ).toBeVisible();
  const [copy] = await native.calls("copy_import_media");
  expect(copy.args).toMatchObject({
    path: "C:/media/clip.MP4",
    directory: "C:/exports",
    verify: true,
  });
  expect((await native.calls("register_import_media"))[0].args.path).toBe("C:/exports/clip.MP4");
});

test("收藏位置随工作区重新挂载恢复，搜索无结果时不丢失待导入项", async ({ app }) => {
  await openImport(app);
  await app.getByRole("button", { name: "收藏位置", exact: true }).click();
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await app.getByRole("textbox", { name: "搜索当前文件夹" }).fill("不存在的媒体");
  await expect(app.getByRole("status").filter({ hasText: "已选择 1 个媒体" })).toBeVisible();
  await expect(app.locator(".import-submit")).toBeEnabled();
  await app.locator(".import-cancel").click();
  await openImport(app);
  await expect(app.getByRole("button", { name: "从收藏夹移除", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(app.locator(".import-submit")).toBeDisabled();
});

test("登记期间冻结操作，重复点击不会重复派发", async ({ app, native }) => {
  await openImport(app);
  await app.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await native.hold("register_import_media");
  await app.locator(".import-submit").dblclick({ noWaitAfter: true });
  await expect(app.getByRole("dialog", { name: "正在登记媒体" })).toBeVisible();
  await expect.poll(async () => (await native.calls("register_import_media")).length).toBe(1);
  await app.keyboard.press("Escape");
  await expect(app.getByRole("dialog", { name: "正在登记媒体" })).toBeVisible();
  await native.release("register_import_media");
  await expect(
    app.locator(".media-bin-panel").getByText("clip.MP4", { exact: true }).first(),
  ).toBeVisible();
  expect(await native.calls("register_import_media")).toHaveLength(1);
});

test("过期目录响应不能覆盖最新导航", async ({ app, native }) => {
  await openImport(app);
  await native.hold("list_import_directory");
  await app.getByRole("button", { name: "选择 nested", exact: true }).press("Enter");
  await expect
    .poll(async () =>
      (await native.calls("list_import_directory")).some(
        (call) => call.args.directory === "C:/media/nested",
      ),
    )
    .toBe(true);
  await app
    .getByRole("navigation", { name: "文件夹路径" })
    .getByRole("button", { name: "media", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await native.calls("list_import_directory")).filter(
          (call) => call.args.directory === "C:/media",
        ).length,
    )
    .toBeGreaterThan(1);
  await native.release("list_import_directory", "C:/media");
  await expect(app.getByRole("button", { name: "选择 clip.MP4", exact: true })).toBeVisible();
  await native.release("list_import_directory", "C:/media/nested");
  await expect(app.getByRole("button", { name: "选择 nested.mov", exact: true })).toHaveCount(0);
  await expect(app.getByRole("button", { name: "选择 clip.MP4", exact: true })).toBeVisible();
});
