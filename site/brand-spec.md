# Locution Pro 品牌与官网约束

## 内容与入口

- 面向视频创作者，介绍媒体管理、画面检索、镜头整理和片段交付。字幕是可选查找方式。
- 素材处理在本机完成；语义检索需要安装可选组件，不展示虚构性能、评分或客户证明。
- 官网地址为 `https://locution.dpdns.org/`；用户指南为 `https://helpx.locution.dpdns.org/`。
- 下载入口保留 `https://openlist.frameneo.com/@s/YRrdPxj2`，GitHub 指向 `GCL-MAD-CLUB/Locution-Pro`。
- 保留 `#features`、`#workflow`、`#local` 锚点、键盘可操作的 FAQ 和检索示例。
- 检索画面明确标注为交互示意，不作为真实检索结果。

## 素材来源

- `assets/locution-icon.png`：应用的 `src-tauri/icons/icon.ico`。
- `assets/locution-app-workspace-light.webp`：维护者提供的实际应用工作区截图，展示素材审看、分镜列表、直方图与关键字面板。
- `assets/locution-overview.svg`：`docs/assets/readme-overview.svg`。
- `assets/official-shot-*.webp`：从上述项目视觉稿裁剪的示意画面。
- `assets/lcp-thumbnail.webp`：项目文件图标，来源于 `src-tauri/thumbnail-provider/assets/lcp-thumbnail.png`。
- `assets/locution-ui-sans.woff2`：项目品牌字体，通过 CSS 外部加载；许可证位于 `assets/FONT-LICENSE.txt`，随站点发布。

## 视觉和交互

- 使用清晰网格、编号和分隔线组织内容。首屏呈现主张与下载入口，后续依次展示真实应用、功能、检索示例、工作流、本地处理、常见问题和下载。
- 配色为纸白 `#F6F5F0`、深色 `#211D24`、品牌紫 `#650565`、洋红 `#F565EC`、浅紫 `#EEE8F1` 和白色。
- 正文与标题使用 Locution UI，功能性元信息使用系统等宽字体；基础间距为 8px。
- 桌面采用多列布局，手机按阅读顺序单列堆叠；内容自然撑开，不使用固定高度裁切正文。
- 保留焦点轮廓、跳至正文入口、示例按钮状态和读屏播报。页面正文在 JavaScript 不可用时仍可阅读。
- 动效限于首屏进入、示例切换、阅读进度和一次性滚动显现。遵循 `prefers-reduced-motion`，关闭动画后保留所有内容。
- 未带内容哈希的资源使用 Cloudflare Pages 默认重新验证缓存。发布流程见 [README](README.md)。
