import { test, expect } from "../support/fixtures";
import { runStateHarness } from "../support/harness";

test("多面板来源锁定、选择隔离及编辑路由", async ({ page }) => {
  expect(await runStateHarness(page, "multi-scope", "runMultiScopeTests", true)).toBeTruthy();
});
