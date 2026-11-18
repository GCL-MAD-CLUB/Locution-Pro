# 测试约定

测试按运行环境分层，再按功能域组织。修复应落入已有功能域，不为每次开发或每个历史问题另建一组测试。

## 目录与职责

| 路径                         | 验证内容                                         |
| ---------------------------- | ------------------------------------------------ |
| `unit/<领域>/<功能>/`        | 确定性的模型、算法、状态转换、错误处理和仓库契约 |
| `browser/workflows/<功能>/`  | 从应用入口执行的用户流程                         |
| `browser/components/<功能>/` | 组件交互、校验、焦点和命令派发                   |
| `browser/state/<功能>/`      | 真实组件与系统之间的状态同步、取消、调度和竞态   |
| `integration/<外部工具>/`    | 按需运行的外部工具契约，例如 Windows NSIS 安装器 |
| `#[cfg(test)] mod tests`     | Rust 实现旁的原生测试                            |

每个测试入口以 `.test.ts` 命名。组件和状态夹具与调用它的测试放在同一功能目录。某层通用的夹具、装载和诊断工具放在该层的 `support/`。Lint 会拒绝跨功能引用其他夹具、跨层依赖和引用其他测试入口。独立场景分别注册用例，确保单独执行时可以完整建立和清理状态。

仓库内手写前端源码和测试统一使用 `.ts` 或 `.tsx`。模板从 TypeScript 入口加载脚本。构建产物由工具生成。测试和夹具均通过严格类型检查，动态边界使用明确类型或 `unknown` 收窄。布局检查覆盖 Git 跟踪文件和未忽略的新建文件。

官网（`site/`）通过 `npm run check:site` 和确定性单测验证。浏览器测试仅覆盖桌面应用。

## 运行入口

```powershell
npm ci
npx playwright install chromium
npm run test:all
```

| 命令                                 | 内容                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `npm test`                           | 测试类型检查、确定性单测和覆盖率门槛                       |
| `npm run test:unit`                  | 通过 Node 运行 `unit/**/*.test.ts`                         |
| `npm run test:coverage`              | 运行单测并生成覆盖率报告，检查全前端及核心逻辑的最低覆盖率 |
| `npm run test:types`                 | 浏览器夹具、Node 测试、维护脚本与官网的类型检查            |
| `npm run test:browser`               | 全部浏览器测试；`test:e2e` 保留为兼容入口                  |
| `npm run test:browser:workflows`     | 应用用户流程                                               |
| `npm run test:browser:components`    | 组件可观察行为                                             |
| `npm run test:browser:state`         | 状态集成与异步竞态                                         |
| `npm run test:all`                   | 类型检查、单元覆盖率和全部浏览器测试                       |
| `npm run test:rust`                  | 主 Rust crate 的默认测试                                   |
| `npm run test:rust:thumbnail`        | 缩略图提供程序的默认测试                                   |
| `npm run test:installer`             | Windows / NSIS 组件复用、损坏修复、清理和可选资源场景      |
| `npm run test:installer-identity`    | Windows / NSIS 安装身份、迁移和向导场景                    |
| `npm run test:installer-maintenance` | Windows / NSIS 维护选择、卸载顺序与独立卸载数据选项        |
| `npm run test:installer-safety`      | 完整 NSIS 模板、安装事务、回滚、更新交接与取消恢复         |
| `npm run test:installer-media`       | 外部媒体工具路径与安装向导校验，不执行真实媒体处理         |

按域或单个场景运行：

```powershell
node --test "tests/unit/search/text/*.test.ts"
npx playwright test tests/browser/components/search --grep "取消"
npm run test:e2e:headed
npm run test:e2e:report
```

调整目录或运行器后，必须运行 `npm run check:layout` 和 `npm test`；移动浏览器测试还需完整运行 `npm run test:browser`。目录检查会拒绝不能被对应运行器发现的后缀和位置。

## 用例与夹具

每个用例围绕一个可观察契约命名，安排初始状态、执行操作、断言结果。独立的键盘、校验与状态恢复场景分开；只有验证连续生命周期时才串联多个阶段。输入边界组合优先放在单元层，浏览器层验证字段提示、阻止操作和修正后的恢复。预期值应来自产品契约，不从被测实现复制列表生成。

浏览器测试断言操作结果、数据与状态变化、输入校验、焦点、持久化和命令参数。Lint 拒绝通用 CSS 断言、视觉快照、静态尺寸和外观属性读取。拖拽和框选通过 `pointerAt` 获取操作坐标，图谱通过自己的夹具验证相机、节点运动与导航边界。状态或交互驱动的界面变化也要验证。优先断言语义状态和渲染结果，例如错误字段、任务进度、主题资源刷新或播放跟随后的视口。若需要读取图谱强调等视觉反馈，在功能夹具内限定可读取的属性，与交互前值或同场景元素比较。主题测试验证设置的预览、应用、恢复与持久化。失败截图仅用于诊断。

所有浏览器测试从 `browser/support/fixtures.ts` 导入 `test` 和 `expect`，获得统一的未捕获异常检查和诊断附件。应用流程使用 `app` / `native` 夹具；`native` 在 Tauri IPC 边界记录命令、拒绝未知命令、检查未预期的应用错误。`native.fail()` 注入失败，`hold()` / `release()` 控制请求返回顺序。隔离组件按需装载自己的最小夹具，不能为隐藏异常而移除诊断。

异步断言等待可观察状态或显式控制的 Promise；不以固定休眠替代结果断言。负向断言若必须跨越防抖窗口，应说明等待的时间契约。状态 harness 必须在 `finally` 中卸载 React 根节点、移除 DOM、恢复替身；外部工具夹具使用测试生命周期清理，递归删除前核对绝对路径和目录归属。

修复用户流程时，覆盖入口、操作和最终结果；涉及派发参数时同时检查命令。根据风险补充失败、取消、重试或来源切换，确认旧响应不会覆盖当前状态，已成功的操作不会重复执行。

## 覆盖率

`npm test` 和普通 CI 使用 `npm run test:coverage` 检查行、语句、函数和分支覆盖率。统计覆盖应用、官网和用户指南主题 TypeScript 源码，也计入单测没有加载的文件。`src/core/` 有独立门槛。当前门槛基于仓库实测基线，分别在 `.c8rc.json` 和 `package.json` 中维护。报告写入 `coverage/`。新增和修改逻辑时优先为正常行为、边界、失败和可能的竞态编写确定性单测。

## 隔离与报告

Playwright 为每个用例创建独立浏览器上下文，拥有并关闭端口 1430 的 Vite 服务，不复用开发服务，不占用端口 1420。不重试失败，不允许 `test.only`，不录制视频。失败 trace、截图、错误和命令附件位于被 Git 忽略的 `test-results/`、`playwright-report/`；常规通过场景不额外生成截图。

Browser regression tests 工作流在相关前端、测试或配置修改时随 PR 运行，也支持每周定时和手动运行。普通 CI 保持确定性单元与默认 Rust 检查；安装器和带资源条件的 Rust 忽略测试由具备条件的环境显式运行。NSIS 命令需要 Windows 和 `NSIS_MAKENSIS` 指定的编译器，默认使用本机 Tauri NSIS 缓存；缺少条件应明确失败。

浏览器测试替换了 Tauri、本地文件系统、原生对话框和媒体工具，不能据此宣称真实 WebView2、项目加密落盘、媒体编码或模型推理已通过。真实外部工具与模型 / GPU 行为仍由对应原生及集成测试验证。
