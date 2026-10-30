import { test, expect, openImport } from "../support/fixtures";

async function importVideo(page: import("@playwright/test").Page) {
  await openImport(page);
  await page.getByRole("button", { name: "选择 clip.MP4", exact: true }).click();
  await page.locator(".import-submit").click();
  const media = page.locator(".media-bin-panel");
  await expect(media.getByText("clip.MP4", { exact: true })).toBeVisible();
  return media;
}

test("媒体重命名、删除、撤销和重做保持内容与历史一致", async ({ app }) => {
  const media = await importVideo(app);
  await media.getByText("clip.MP4", { exact: true }).dblclick();
  const name = media.getByRole("textbox", { name: "重命名媒体", exact: true });
  await name.fill("镜头改名");
  await name.press("Enter");
  await expect(media.getByText("镜头改名", { exact: true })).toBeVisible();
  await media.getByRole("row").filter({ hasText: "镜头改名" }).click();
  await app.keyboard.press("Delete");
  await expect(media.getByText("镜头改名", { exact: true })).toHaveCount(0);
  await app.keyboard.press("Control+z");
  await expect(media.getByText("镜头改名", { exact: true })).toBeVisible();
  await app.keyboard.press("Control+Shift+z");
  await expect(media.getByText("镜头改名", { exact: true })).toHaveCount(0);
});

test("媒体启用开关参与撤销，搜索输入中的删除不会删除项目媒体", async ({ app }) => {
  const media = await importVideo(app);
  const enabled = media.getByRole("checkbox", { name: "启用 clip.MP4", exact: true });
  await enabled.uncheck();
  await expect(enabled).not.toBeChecked();
  await media.getByRole("row").filter({ hasText: "clip.MP4" }).click();
  await app.keyboard.press("Control+z");
  await expect(enabled).toBeChecked();
  await media.getByRole("row").filter({ hasText: "clip.MP4" }).click();
  const search = media.getByRole("textbox", { name: "搜索媒体", exact: true });
  await search.fill("clip");
  await search.press("Control+a");
  await search.press("Delete");
  await expect(search).toHaveValue("");
  await expect(media.getByText("clip.MP4", { exact: true })).toBeVisible();
});

test("项目只读时阻止删除与修改，解除后可以继续编辑", async ({ app }) => {
  const media = await importVideo(app);
  await media.getByRole("row").filter({ hasText: "clip.MP4" }).click();
  await media.getByRole("button", { name: "将项目设为只读", exact: true }).click();
  await expect(media.getByRole("button", { name: "移除所选项目条目", exact: true })).toBeDisabled();
  await expect(media.getByRole("checkbox", { name: "启用 clip.MP4", exact: true })).toBeDisabled();
  await media.getByRole("button", { name: "解除项目只读", exact: true }).click();
  await expect(media.getByRole("checkbox", { name: "启用 clip.MP4", exact: true })).toBeEnabled();
  await expect(media.getByText("clip.MP4", { exact: true })).toBeVisible();
});
