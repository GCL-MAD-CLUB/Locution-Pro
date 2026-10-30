import { test, expect } from "../support/fixtures";
import { runStateHarness } from "../support/harness";

test("镜头检测并发、排队、取消和失败恢复", async ({ page }) => {
  expect(
    await runStateHarness(page, "storyboard-scheduling", "runStoryboardSchedulingTests"),
  ).toBeTruthy();
});
