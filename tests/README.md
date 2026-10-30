# 测试约定

测试按运行环境分层，再按功能域组织。修复应落入已有功能域，不为每次开发或每个历史问题另建一组测试。

## 目录与职责

| 层级     | 目录                                      | 验证内容                                           |
| -------- | ----------------------------------------- | -------------------------------------------------- |
| 单元     | `unit/search/`                            | 文本匹配、查询转换、配置校验、历史记录和语义评分   |
| 单元     | `unit/media/`                             | 导入、来源、字幕派生数据、分镜布局和播放参数       |
| 单元     | `unit/project/`                           | 项目历史、保存状态和导出任务派发                   |
| 单元     | `unit/runtime/`                           | 任务系统、运行环境、外部链接和更新检查             |
| 单元     | `unit/tooling/`                           | 仓库目录和测试发现规则                             |
| 浏览器   | `browser/workflows/`                      | 从应用入口完成导入、编辑、导出、设置等用户流程     |
| 浏览器   | `browser/components/`                     | 隔离组件的交互、键盘、样式和配置同步               |
| 浏览器   | `browser/state/`                          | 真实组件与系统之间的异步状态、取消、调度和来源隔离 |
| 外部工具 | `integration/installer/`                  | 真实 NSIS 编译与隔离安装器夹具，按需运行           |
| Rust     | 被测实现文件内的 `#[cfg(test)] mod tests` | 原生行为；不得另建 Rust 测试文件或目录             |

`unit/support/` 和 `browser/support/` 保存各层共用的夹具、装载和诊断工具。组件、状态 harness 与调用它的测试放在同一功能域；不得保留无入口的手动实验。真实媒体、编码和模型 / GPU 检查不进入普通 CI。

## 运行入口

```powershell
npm ci
npx playwright install chromium
npm run test:all
```

| 命令                              | 内容                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `npm test`                        | 测试类型检查和全部确定性单元测试                        |
| `npm run test:unit`               | `unit/*/*.test.mjs`；直接运行 Node 测试，不重复类型检查 |
| `npm run test:types`              | 浏览器测试与 TypeScript 测试支持代码的类型检查          |
| `npm run test:browser`            | 全部浏览器测试；`test:e2e` 保留为兼容入口               |
| `npm run test:browser:workflows`  | 应用用户流程                                            |
| `npm run test:browser:components` | 组件交互与样式                                          |
| `npm run test:browser:state`      | 状态集成与异步竞态                                      |
| `npm run test:all`                | 类型检查、单元和全部浏览器测试                          |
| `npm run test:rust`               | 主 Rust crate 的默认测试                                |
| `npm run test:rust:thumbnail`     | 缩略图提供程序的默认测试                                |
| `npm run test:installer`          | Windows / NSIS 组件复制与可选资源场景                   |
| `npm run test:installer-identity` | Windows / NSIS 安装身份、迁移和向导场景                 |

按域或单个场景运行：

```powershell
node --test "tests/unit/search/*.test.mjs"
npx playwright test tests/browser/components/search --grep "取消"
npm run test:e2e:headed
npm run test:e2e:report
```

调整目录或运行器后，必须运行 `npm run check:layout` 和 `npm test`；移动浏览器测试还需完整运行 `npm run test:browser`。目录检查会拒绝不能被对应运行器发现的后缀和位置。

## 用例与夹具

每个用例围绕一个可观察契约命名，安排初始状态、执行操作、断言结果。独立的样式、键盘、校验与状态恢复场景分开；只有验证连续生命周期时才串联多个阶段。输入边界组合优先放在单元层，浏览器层验证字段提示、阻止操作和修正后的恢复。预期值应来自产品契约，不从被测实现复制列表生成。

所有浏览器测试从 `browser/support/fixtures.ts` 导入 `test` 和 `expect`，获得统一的未捕获异常检查和诊断附件。应用流程使用 `app` / `native` 夹具；`native` 在 Tauri IPC 边界记录命令、拒绝未知命令、检查未预期的应用错误。`native.fail()` 注入失败，`hold()` / `release()` 控制请求返回顺序。隔离组件按需装载自己的最小夹具，不能为隐藏异常而移除诊断。

异步断言等待可观察状态或显式控制的 Promise；不以固定休眠替代结果断言。负向断言若必须跨越防抖窗口，应说明等待的时间契约。状态 harness 必须在 `finally` 中卸载 React 根节点、移除 DOM、恢复替身；外部工具夹具使用测试生命周期清理，递归删除前核对绝对路径和目录归属。

修复用户流程时，覆盖入口、操作和最终结果；涉及派发参数时同时检查命令。根据风险补充失败、取消、重试或来源切换，确认旧响应不会覆盖当前状态，已成功的操作不会重复执行。

## 隔离与报告

Playwright 为每个用例创建独立浏览器上下文，拥有并关闭端口 1430 的 Vite 服务，不复用开发服务，不占用端口 1420。不重试失败，不允许 `test.only`，不录制视频。失败 trace、截图、错误和命令附件位于被 Git 忽略的 `test-results/`、`playwright-report/`；常规通过场景不额外生成截图。

Browser regression tests 工作流在相关前端、测试或配置修改时随 PR 运行，也支持每周定时和手动运行。普通 CI 保持确定性单元与默认 Rust 检查；安装器和带资源条件的 Rust 忽略测试由具备条件的环境显式运行。NSIS 命令需要 Windows 和 `NSIS_MAKENSIS` 指定的编译器，默认使用本机 Tauri NSIS 缓存；缺少条件应明确失败。

浏览器测试替换了 Tauri、本地文件系统、原生对话框和媒体工具，不能据此宣称真实 WebView2、项目加密落盘、媒体编码或模型推理已通过。真实外部工具与模型 / GPU 行为仍由对应原生及集成测试验证。
