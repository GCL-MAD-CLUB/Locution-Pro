import { test, expect } from "../../support/fixtures";

test("媒体浏览器能按最终扩展名显示并选择大写视频，不能误选其他格式", async ({ page, native }) => {
  void native;
  await page.goto("/tests/browser/components/media/media-dialogs.html");
  const files = page.getByRole("grid", { name: "文件和文件夹" });
  await expect(files.getByRole("button", { name: /clip.MP4/ })).toBeVisible();
  await files.getByRole("button", { name: /clip.MP4/ }).click();
  await page.locator(".modal-dialog-confirm").click();
  await expect(page.getByLabel("操作结果")).toHaveText('["C:/media/clip.MP4"]');
});

test("链接媒体保留文件名匹配，媒体浏览器能建议并附加同名大写扩展名文件", async ({
  page,
  native,
}) => {
  void native;
  await page.goto("/tests/browser/components/media/media-dialogs.html?kind=link");
  await page.getByRole("checkbox", { name: "使用媒体浏览器附加文件", exact: true }).check();
  await page.getByRole("button", { name: "附加", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "将媒体链接到 镜头一", exact: true }),
  ).toBeVisible();
  const clip = page
    .getByRole("grid", { name: "文件和文件夹" })
    .getByRole("button", { name: /clip.MP4/ });
  await expect(clip).toHaveAttribute("aria-selected", "true");
  await page.locator(".modal-dialog-confirm").click();
  await expect(page.getByLabel("操作结果")).toHaveText('["C:/media/clip.MP4"]');
});
