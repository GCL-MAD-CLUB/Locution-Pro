import { test, expect } from "../../support/fixtures";
import { runStateHarness } from "../../support/harness";

test("字幕语义索引、检索和取消竞态", async ({ page }) => {
  expect(
    await runStateHarness(
      page,
      "/tests/browser/state/subtitle-semantic/subtitle-semantic.harness.ts",
      "runSubtitleSemanticTests",
    ),
  ).toBeTruthy();
});

for (const available of [true, false]) {
  test(
    available ? "字幕表格排序、阈值和列配置" : "未安装语义组件时恢复普通搜索",
    async ({ page }) => {
      expect(
        await runStateHarness(
          page,
          "/tests/browser/state/subtitle-semantic/subtitle-semantic.harness.ts",
          "runSubtitleSemanticTableTests",
          {
            available,
          },
        ),
      ).toBeTruthy();
    },
  );
}
