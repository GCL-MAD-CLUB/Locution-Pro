# macOS 构建

本文面向在 macOS 上本地构建和调试的开发者。CI 在 macOS 上运行 Rust 的 clippy 与测试；发布流程与 Windows 并行构建 arm64 的 `.dmg` 与自动更新包，并写入同一份 `latest.json`（平台键 `darwin-aarch64`），自动更新的规则见[发布流程](releasing.md)。macOS 包使用 ad-hoc 签名（`signingIdentity: "-"`），未经公证。

## 环境

- Apple 芯片（arm64）或 Intel Mac，macOS 13 或更高版本。
- Node.js 与 Rust 版本与 Windows 相同（见 `.node-version` 和 `rust-toolchain.toml`）。
- 本机 FFmpeg，例如 `brew install ffmpeg`；或设置 `LOCUTION_PRO_FFMPEG_DIR` 指向包含 `ffmpeg` 和 `ffprobe` 的目录。

## 准备与运行

```bash
npm ci
npm run prepare:transnetv2
npm run prepare:ffmpeg
npm run prepare:semantic
npm run prepare:storyboard-semantic
npm run tauri dev
```

在 macOS 上，`prepare:transnetv2` 下载官方 `onnxruntime-osx-<arch>` 包并放置 `libonnxruntime.dylib`，不下载 DirectML。`prepare:ffmpeg` 复制本机 FFmpeg；Homebrew 版本依赖 Homebrew 动态库，生成的应用只能在装有同样 Homebrew FFmpeg 的机器上运行。需要可分发的包时，请提供静态构建的 FFmpeg。

`src-tauri/tauri.macos.conf.json` 在 macOS 上覆盖打包目标（`.app` 与 `.dmg`）、图标，并移除 Windows 缩略图提供程序。`npm run tauri build -- --debug` 可生成本地调试包；release 构建与 Windows 一样需要 `LOCUTION_PRO_PROJECT_BUILD_SECRET_V1`，否则构建会被拒绝。不要为了本地测试生成新的密钥：用不同密钥构建的应用无法打开正式版本创建的项目文件。

发布流程下载固定版本、按 SHA-256 校验的静态 arm64 FFmpeg（只链接系统框架），通过 `LOCUTION_PRO_FFMPEG_DIR` 交给 `prepare:ffmpeg`，许可证见 `THIRD_PARTY_NOTICES`。包未经公证，从浏览器下载后首次打开需要在“系统设置 → 隐私与安全性”中允许；接入 Developer ID 签名与公证时，设置 `APPLE_SIGNING_IDENTITY` 等 Tauri 签名环境变量即可覆盖 ad-hoc 签名。

## 已知差异

- WebKit 无法直接播放 MKV 等封装，导入时会提示创建代理；镜头检测与语义索引仍读取原始文件。
- 程序与 FFmpeg 5.1 及以上版本兼容（已不使用 FFmpeg 9 移除的 `-vsync`）。
- ad-hoc 签名的身份随每次构建变化，因此重新构建后，macOS 会再次询问下载、文稿等文件夹的访问权限，确认前文件夹列表保持“正在读取”。
- 数据与缓存目录目前为 `~/.locution-pro`，尚未迁移到 `~/Library/Application Support`。

## GPU 加速

Windows 使用 DirectML；macOS 通过 ONNX Runtime 的 CoreML 执行提供程序在 Metal GPU 上推理。镜头检测解码使用 VideoToolbox，把 CPU 留给 TransNetV2；画面语义索引逐帧解码时使用多线程软件解码，在 Apple 芯片上约为 VideoToolbox 的 4 倍。

CoreML 的算子覆盖与模型有关，部分支持的图会被切成多段，在 CPU 与 GPU 之间来回传输，反而比纯 CPU 更慢。因此 CoreML 按模型启用（`onnx::Accelerators`）：

| 模型                 | macOS 提供程序 | 原因                                      |
| :------------------- | :------------- | :---------------------------------------- |
| DINOv3 画面语义      | CoreML         | 批次 8 约 2.3 倍、批次 16 约 3.6 倍于 CPU |
| SigLIP2 视觉         | CoreML         | 738/743 个节点在 GPU 上，约 11 倍于 CPU   |
| TransNetV2 镜头检测  | CPU            | CoreML 不支持 3D 卷积，启用后更慢         |
| 字幕语义检索（int8） | CPU            | CoreML 缺少量化算子，图被切成多段         |

加载时依次尝试固定形状的 MLProgram 和 NeuralNetwork 格式，均失败时回退 CPU；推理失败仍沿用共享的 CPU 恢复逻辑。为绕过 ONNX Runtime CoreML 转换器的缺陷，`onnx/coreml.rs` 会在加载前改写一份模型副本：内联 `.onnx_data` 外部权重，并把 `auto_pad = VALID` 或缺省填充的 Conv 写成等价的显式零 `pads`。

CoreML 首次编译每个模型和批次形状需要数十秒（M3 Pro 上 DINOv3 约 24 秒、SigLIP2 约 90 秒），因此 macOS GPU 上不做批次调优，固定使用批次 16，尾部补齐；该形状失败或回退 CPU 后恢复调优。17 分钟 1080p 剧集首次构建分镜索引约 4 分钟（逐个调优时约 11.5 分钟）。编译结果缓存在 `~/Library/Caches/com.locutionpro.desktop/coreml`，之后加载不到一秒。转换器拒绝的组合会记录在缓存中，下次直接跳过。诊断时可用 `LOCUTION_PRO_COREML_COMPUTE_UNITS`（`CPUAndGPU`、`ALL`、`CPUAndNeuralEngine`、`CPUOnly`）覆盖计算单元；默认 `CPUAndGPU`，因为包含神经网络引擎的会话每次加载都要重新编译。

GPU 与 CPU 结果一致性测试默认忽略，需要准备全部模型后手动运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored gpu_matches_cpu provider_diagnostics loads_with_gpu_provider retrieval_smoke
```
