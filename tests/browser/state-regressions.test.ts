import { test, expect } from "./fixtures";

// Preserve the existing detailed hook contracts, now under an isolated browser,
// bounded timeout, automatic discovery and failure artifacts for every run.
for (const scenario of [
  {
    name: "多面板来源锁定、选择隔离及编辑路由",
    file: "multi-scope",
    entry: "runMultiScopeTests",
    argument: true,
  },
  {
    name: "镜头检测并发、排队、取消和失败恢复",
    file: "storyboard-scheduling",
    entry: "runStoryboardSchedulingTests",
  },
  {
    name: "字幕语义索引、检索和取消竞态",
    file: "subtitle-semantic",
    entry: "runSubtitleSemanticTests",
  },
  {
    name: "字幕表格排序、阈值和列配置",
    file: "subtitle-semantic",
    entry: "runSubtitleSemanticTableTests",
    argument: { available: true },
  },
  {
    name: "未安装语义组件时恢复普通搜索",
    file: "subtitle-semantic",
    entry: "runSubtitleSemanticTableTests",
    argument: { available: false },
  },
]) {
  test(scenario.name, async ({ page }) => {
    await page.goto("/tests/browser/blank.html");
    const result = await page.evaluate(async ({ file, entry, argument }) => {
      const module = await import(/* @vite-ignore */ `/tests/browser/${file}.harness.js`);
      return module[entry](argument);
    }, scenario);
    expect(result).toBeTruthy();
  });
}
