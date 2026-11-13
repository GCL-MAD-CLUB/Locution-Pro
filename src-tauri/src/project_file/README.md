# 项目文件维护契约

本目录是 Locution Pro 0.4.2 的项目文件边界，面向维护者。用户保存、恢复和交接步骤位于用户指南，不应包含这里的格式与密钥细节。

## 所有权

外部只调用根 mod 暴露的路径规范化、读取当前工作区、写入和自动保存能力。DTO、内容版本、升级链、明文载荷、密钥与加密信封不得越过此边界。

| 文件         | 责任                               |
| ------------ | ---------------------------------- |
| mod.rs       | 读写编排、逐级升级与当前工作区转换 |
| auto_save.rs | 内容变化检测、命名与每项目保留数量 |
| io.rs        | 文件边界、同步临时文件与替换       |
| handle_v1.rs | 旧容器、V1 DTO 与校验              |
| models       | 冻结内容模型与相邻升级             |
| protocol.rs  | 当前加密信封                       |
| keyring.rs   | 密钥选择、身份与派生               |

## 内容模型

当前内容模型为 V4，`models/mod.rs` 的 Current 指向 v4。V3 保存分镜和字幕标注，V4 增加稳定 project_id。V1 经完整相邻迁移链升级，正常保存统一写入当前模型；更高内容版本应明确拒绝，不按应用 SemVer 猜测格式。

已发布 vN DTO 与迁移冻结。新增模型必须提供完整 DTO、ProjectModel 和前一版的 UpgradeFrom，再更新 Current 与升级链；不得原地修改旧模型。

媒体组织、轨道关系、原始字幕与标注、镜头、删除恢复信息、堆叠和关键字属于项目。自动合并字幕只是共享读取视图，不能将显示合并悄悄写回源 cue。临时勾选、搜索、视图与导出范围不加入项目模型。

## 磁盘 JSON 字段

内容载荷是 JSON。键名由各类型上的 serde 属性决定，已有键不因 Rust 类型改名而批量重命名。`from_runtime` 与 `into_runtime` 经 `serde_json::Value` 互转，所以运行时 `ProjectWorkspace`（及其中的 `MediaDocument`）与当前 V4 DTO 必须写出同一套键。

没有 `rename_all` 的结构体使用 Rust 字段名。模型和运行时工作区里这些名字是 snake_case：根上的 `project_id`、`saved_at`、`app_version`，工作区的 `projects`、`media_bin`、`editor`、`subtitles`、`storyboards`，以及媒体、轨道和镜头时间，例如 `file_name`、`avg_frame_rate`、`start_us`。工作区列表的键保持 `projects`。运行时元素类型已是 `MediaDocument`，磁盘 DTO 仍把这条媒体记录放在该列表中，键不改成类型名。

字幕标注、`SubtitleState`，以及分镜标注、关键字、堆叠、使用计数和 `StoryboardState` 使用 `rename_all = "camelCase"`。因此键是 `cueAnnotations`、`colorLabel`、`customLabel`、`shotAnnotations`、`keywordNodes`、`shotStacks`、`recentKeywordIds`、`keywordUsageCounters`、`deletedShots`、`keywordIds`、`parentId`、`shotIds`。镜头记录本身仍是 snake_case。枚举使用 `rename_all = "snake_case"`，例如 `embedded`、`external`、`imported`、`decomposed`，颜色为 `red`、`yellow`、`green`、`blue`、`purple`。

导入命令的 `ImportResult` 把同一份媒体记录放在字段 `project` 下，没有 serde rename。该键属于命令载荷，不是 `.lcp` 正文；类型改为 `MediaDocument` 后键仍然是 `project`。

当前和历史内容结构大多带 `deny_unknown_fields`，未声明的键解码失败。没有 `default` 的字段必须出现；`Option` 写成具体值或 `null`。`#[serde(default)]` 让旧文件缺键时取 `Default`（空串、`None`、空集合）。`project_id`、`tape_name`、工作区 `subtitles`、分镜 `custom_label` 与 `keyword_usage_counters` 按此读取。V4 的 `storyboards` 没有 `default`，迁移后的模型总是带这个键；运行时 `ProjectWorkspace` 的 `subtitles` 与 `storyboards` 标了 `default`，缺键时解码为空表。`synonyms` 与 `deleted_shots` 同时使用 `default` 和 `skip_serializing_if = "Vec::is_empty"`，缺键读成空数组，空数组不写出；在 camelCase 类型上对应键是 `synonyms` 与 `deletedShots`。

只为打开旧文件、保存时不再写回的键使用 `default`、`skip_serializing`，并用 `rename` 对准旧名：`subtitle_selections`、`export_state`。

新增持久字段要同时加在运行时模型和当前 DTO 上，JSON 键保持一致。旧文件可能没有的键在当前模型上标 `default`。已发布的旧版本 DTO 不原地改字段名；新内容版本沿用上述命名，而不是把已有键批量改成另一种大小写。

## 加密协议

V2 及以上使用 XChaCha20-Poly1305 信封和 HKDF-SHA-256 派生，每次保存生成独立盐与 nonce。头部关键字段作为认证数据，明文和派生密钥离开作用域时清除。信封协议与内容版本独立演进，不能因产品版本变化而随意升级内容 DTO。

新保存使用协议 2 与 LocutionPro 派生上下文，扩展名仍为 `.lcp`，信封标识仍为 LCSEAL2。读取兼容旧协议与密钥槽；重新保存后，较早应用可能无法打开，应在用户帮助中说明保留原项目副本。

正式构建密钥必须跨版本稳定。读取顺序为：

1. LOCUTION_PRO_PROJECT_BUILD_SECRET_V1 环境变量。
2. LINECUT_PROJECT_BUILD_SECRET_V1 旧环境变量。
3. .locution-pro-project-build-secret-v1.local 私密文件。
4. .linecut-project-build-secret-v1.local 旧私密文件。

正式构建缺少密钥时失败；开发构建采用稳定开发密钥。变量更名不改变值。本地无密码应用具备解密能力，不能将混淆描述为抵抗进程调试或逆向的绝对保密。

## 保存与自动保存

使用同步临时文件和替换提交，不创建 `.lcp.bak`。手动保存与整轮自动保存共用串行提交边界。

自动保存使用首选项的独立路径，初始默认是缓存根下的 Locution Pro Auto-Save。默认路径解析后独立保存，改变缓存根不改变它；清空配置可采用新的默认路径。更改位置不迁移旧文件。

自动保存按项目身份与内容识别，重复内容不生成冗余版本，保留上限按项目计算。恢复文件使用与普通保存一致的模型和信封。

开启同时保存当前项目时，先生成恢复文件，再写已有正式路径；未命名项目不弹出路径窗口。异步完成只标记开始时捕获的历史位置，不能清除期间的新编辑或覆盖另一个项目的保存状态。

## 本机配置与兼容

ProjectStatesCache 与 backend/workspace 管理按项目和面板保存的本机状态，不进入 V4。单面板写入不能覆盖其他面板或导出设置。

来源工作区、锁定、播放位置和来源导航在本机恢复；临时搜索、筛选、选择和导出范围不随项目交付。项目自动保存也不应成为这些本机配置的备份。

变更时验证旧文件读取、往返保存、损坏拒绝、未来版本拒绝、自动保存变化检测、每项目轮转及并发保存状态。Rust 测试内联，详见[贡献指南](../../../CONTRIBUTING.md)。
