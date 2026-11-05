# Locution Pro 品牌与官网约束

## 内容与入口

- 面向视频创作者，介绍媒体管理、画面检索、镜头整理和片段交付。字幕是可选查找方式。
- 素材处理在本机完成；语义检索需要安装可选组件，不展示虚构性能、评分或客户证明。
- 官网地址为 `https://locution.dpdns.org/`；用户指南为 `https://helpx.locution.dpdns.org/`。
- 下载入口使用安装包直链 `https://openlist.frameneo.com/sd/YRrdPxj2/Locution.Pro_<版本>_x64-setup.exe`，由发版脚本同步版本，不额外打开空白标签页。GitHub 指向 `GCL-MAD-CLUB/Locution-Pro`。
- 保留 `#features`、`#workflow`、`#local` 锚点、键盘可操作的 FAQ 和检索示例。
- 检索画面明确标注为交互示意，不作为真实检索结果。

## 素材来源

- `assets/locution-icon.png`：应用的 `src-tauri/icons/icon.ico`。
- `assets/locution-app-workspace-light.webp`：维护者提供的实际应用工作区截图，展示素材审看、分镜列表、直方图与关键字面板。
- `assets/locution-app-import-light.webp`、`assets/locution-app-export-light.webp`：维护者提供的导入、导出工作区截图，保留原始尺寸并转为无损 WebP。
- `assets/locution-overview.svg`：`docs/assets/readme-overview.svg`。
- `assets/official-shot-*.webp`：从上述项目视觉稿裁剪的示意画面。
- `assets/lcp-thumbnail.webp`：项目文件图标，来源于 `src-tauri/thumbnail-provider/assets/lcp-thumbnail.png`。
- `assets/locution-ui-sans.woff2`：项目品牌字体，通过 CSS 外部加载；许可证位于 `assets/FONT-LICENSE.txt`，随站点发布。

## 视觉和交互

- 使用清晰网格、编号和分隔线组织内容。首屏呈现主张与下载入口，后续依次展示真实应用、功能、检索示例、工作流、本地处理、常见问题和下载。
- 配色为纸白 `#F6F5F0`、深色 `#211D24`、品牌紫 `#650565`、洋红 `#F565EC`、浅紫 `#EEE8F1` 和白色。
- 正文与标题使用 Locution UI，功能性元信息使用系统等宽字体；基础间距为 8px。
- 桌面章节以扣除实际导航栏后的视口高度为最小高度，标题、间距和截图尺寸随窗口高度调整。短窗口和手机上的长内容自然撑开，不缩小正文或裁切内容。
- 工作区截图保持原始比例，点击中心图在当前网页的弹窗中查看完整截图，支持关闭按钮、遮罩和 Escape 关闭，打开时锁定背景滚动并限制焦点在弹窗内。横屏默认编辑图居中最大，导入、导出图缩小并被中心图部分遮挡；支持按钮、侧图、左右方向键及横向触摸滑动切换，无自动播放。竖屏或 JavaScript 不可用时仅展示编辑图。核心能力采用两列分栏，手机上的检索选项和示例图片并排展示。
- 章节按 00–07 编号。桌面侧边目录和顶部导航同步显示阅读位置；手机目录使用原生展开控件，支持选择后关闭、Escape 和点击外部关闭。
- 桌面端在滚轮或翻页键输入时直接计算相邻章节落点，以逐帧动画对齐导航栏下沿；同一段滚轮惯性只触发一次过渡，反向输入可立即改变目标，不在滚动结束后追加吸附。章节高度、导航栏和窗口变化后重新测量落点。超过一屏的章节内部、页脚、嵌套滚动区域、弹窗、触摸设备和减少动态效果模式保留原生滚动，避免遗漏内容或将页脚拉回正文。
- 保留焦点轮廓、跳至正文入口、示例按钮状态和读屏播报。页面正文在 JavaScript 不可用时仍可阅读。
- 动效限于首屏进入、章节过渡、工作区轮播、示例切换、阅读进度和一次性滚动显现。遵循 `prefers-reduced-motion`，关闭动画后保留所有内容。
- 未带内容哈希的资源使用 Cloudflare Pages 默认重新验证缓存。发布流程见 [README](README.md)。
