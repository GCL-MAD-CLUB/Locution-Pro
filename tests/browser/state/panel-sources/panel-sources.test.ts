import { test, expect } from "../../support/fixtures";
import { runStateHarness } from "../../support/harness";
import type { PanelSourceScenario } from "./multi-scope.harness";

const scenarios = {
  import: "首批导入初始化各面板来源且不附加编辑历史",
  "asset-preview": "素材属性播放保持分镜图谱和工作区来源",
  follow: "播放跟随使用正确来源和时间轴，暂停后停止滚动",
  merge: "分镜合并验证相邻关系，跨来源编辑可统一撤销",
  history: "来源、选择和编辑状态随项目历史正确恢复",
  detection: "识别结果遇到并发编辑或来源删除时保持项目一致",
} satisfies Record<PanelSourceScenario, string>;

for (const [scenario, title] of Object.entries(scenarios)) {
  test(title, async ({ page }) => {
    expect(
      await runStateHarness(
        page,
        "/tests/browser/state/panel-sources/multi-scope.harness.ts",
        "runPanelSourceScenario",
        scenario,
      ),
    ).toBe(true);
  });
}
