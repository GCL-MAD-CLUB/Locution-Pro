use crate::{app_error, AppResult, ErrorCode, ProjectWorkspace};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use super::{v4, CurrentProjectModel, ProjectModel, UpgradeFrom, UpgradeParts};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(in crate::project_file) struct Model {
    /// Stable per-document identity, carried over from V4. `default` keeps a
    /// missing id decodable; the read path then mints one and writes it back.
    #[serde(default)]
    project_id: String,
    workspace: Workspace,
    saved_at: u64,
    app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Workspace {
    projects: Vec<Project>,
    media_bin: MediaBinState,
    editor: EditorState,
    #[serde(default)]
    subtitles: BTreeMap<String, SubtitleState>,
    storyboards: BTreeMap<String, StoryboardState>,
    /// Introduced with V5; upgraded V4 workspaces start with an empty library.
    #[serde(default)]
    asset_library: AssetLibraryState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Project {
    asset: MediaAsset,
    streams: Vec<MediaStream>,
    tracks: Vec<SubtitleTrack>,
    cues: BTreeMap<String, Vec<SubtitleCue>>,
    cache_dir: String,
    proxy_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaAsset {
    id: String,
    path: String,
    file_name: String,
    file_size: i64,
    modified_at: i64,
    fingerprint: String,
    duration_us: i64,
    start_time_us: i64,
    #[serde(default)]
    tape_name: Option<String>,
    video_stream_index: Option<i32>,
    audio_stream_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaStream {
    index: i32,
    codec_type: String,
    codec_name: String,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    sample_aspect_ratio: Option<String>,
    sample_rate: Option<String>,
    channel_layout: Option<String>,
    language: Option<String>,
    title: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    channels: Option<i64>,
    disposition: BTreeMap<String, i32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SubtitleSourceType {
    Embedded,
    External,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SubtitleKind {
    Text,
    Bitmap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubtitleTrack {
    id: String,
    asset_id: String,
    source_type: SubtitleSourceType,
    stream_index: Option<i32>,
    source_path: Option<String>,
    codec: String,
    language: Option<String>,
    title: Option<String>,
    kind: SubtitleKind,
    offset_us: i64,
    cue_count: usize,
    warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SubtitleCue {
    id: String,
    track_id: String,
    sequence: i32,
    start_us: i64,
    end_us: i64,
    raw_text: String,
    plain_text: String,
    speaker: Option<String>,
    style: Option<String>,
    layer: Option<i32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MediaBinItemKind {
    Video,
    Audio,
    Subtitle,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MediaBinItemOrigin {
    Imported,
    Decomposed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaBinItem {
    id: String,
    bin_id: Option<String>,
    kind: MediaBinItemKind,
    enabled: bool,
    hidden: bool,
    offline: bool,
    path: String,
    file_name: String,
    duration_us: i64,
    start_time_us: i64,
    bound_to_video_id: Option<String>,
    source_video_id: Option<String>,
    stream_index: Option<i32>,
    subtitle_track_id: Option<String>,
    codec: Option<String>,
    language: Option<String>,
    extracted: bool,
    origin: MediaBinItemOrigin,
    color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaBinFolder {
    id: String,
    name: String,
    parent_id: Option<String>,
    color: String,
    hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaBinState {
    items: Vec<MediaBinItem>,
    folders: Vec<MediaBinFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreviewState {
    use_proxy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct EditorState {
    active_video_id: String,
    active_track_id: String,
    detached_video_ids: Vec<String>,
    preview: PreviewState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SubtitleColorLabel {
    Red,
    Yellow,
    Green,
    Blue,
    Purple,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubtitleAnnotation {
    rating: u8,
    retained: bool,
    excluded: bool,
    color_label: Option<SubtitleColorLabel>,
    custom_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubtitleState {
    cue_annotations: BTreeMap<String, SubtitleAnnotation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoryboardShot {
    id: String,
    sequence: usize,
    start_frame: usize,
    end_frame: usize,
    start_us: i64,
    end_us: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StoryboardColorLabel {
    Red,
    Yellow,
    Green,
    Blue,
    Purple,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoryboardAnnotation {
    rating: u8,
    retained: bool,
    excluded: bool,
    title: Option<String>,
    keyword_ids: BTreeSet<String>,
    color_label: Option<StoryboardColorLabel>,
    #[serde(default)]
    custom_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoryboardKeywordNode {
    id: String,
    name: String,
    parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    synonyms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoryboardStack {
    id: String,
    shot_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoryboardKeywordUsageCounters {
    counts: BTreeMap<String, u64>,
    total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoryboardState {
    shots: Vec<StoryboardShot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    deleted_shots: Vec<StoryboardShot>,
    shot_stacks: Vec<StoryboardStack>,
    keyword_nodes: Vec<StoryboardKeywordNode>,
    recent_keyword_ids: Vec<String>,
    #[serde(default)]
    keyword_usage_counters: StoryboardKeywordUsageCounters,
    shot_annotations: BTreeMap<String, StoryboardAnnotation>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AssetLibraryRoot {
    Subtitles,
    Storyboards,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AssetLibraryColorLabel {
    Red,
    Yellow,
    Green,
    Blue,
    Purple,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetLibraryFolder {
    id: String,
    root: AssetLibraryRoot,
    parent_id: Option<String>,
    name: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetLibraryMedia {
    video_id: String,
    path: String,
    file_name: String,
    fingerprint: String,
    frame_rate: f64,
    duration_us: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetLibraryAnnotation {
    rating: u8,
    retained: bool,
    excluded: bool,
    color_label: Option<AssetLibraryColorLabel>,
    custom_label: Option<String>,
    title: Option<String>,
    keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetLibraryEntry {
    id: String,
    root: AssetLibraryRoot,
    folder_id: Option<String>,
    name: String,
    created_at: i64,
    media: AssetLibraryMedia,
    start_us: i64,
    end_us: i64,
    text: String,
    annotation: AssetLibraryAnnotation,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetLibraryState {
    folders: Vec<AssetLibraryFolder>,
    entries: Vec<AssetLibraryEntry>,
}

impl ProjectModel for Model {
    const VERSION: u16 = 5;

    fn decode(payload: &[u8]) -> AppResult<Self> {
        serde_json::from_slice(payload).map_err(|error| {
            app_error(
                ErrorCode::ProjectDecodeFailed,
                format!("Failed to decode the V5 project model: {error}"),
            )
        })
    }

    fn encode(&self) -> AppResult<Vec<u8>> {
        serde_json::to_vec(self).map_err(|error| {
            app_error(
                ErrorCode::ProjectEncodeFailed,
                format!("Failed to encode the V5 project model: {error}"),
            )
        })
    }

    fn into_upgrade_parts(self) -> AppResult<UpgradeParts> {
        let workspace = serde_json::to_value(self.workspace).map_err(|error| {
            app_error(
                ErrorCode::ProjectMigrationFailed,
                format!("Failed to convert the V5 workspace into migration data: {error}"),
            )
        })?;
        Ok(UpgradeParts {
            workspace,
            saved_at: self.saved_at,
            app_version: self.app_version,
        })
    }
}

impl UpgradeFrom<v4::Model> for Model {
    fn upgrade_from(previous: v4::Model) -> AppResult<Self> {
        // V4 already carries the document identity; keep it so per-project local
        // state stays attached across the upgrade.
        let project_id = previous.project_id().to_string();
        let UpgradeParts {
            workspace,
            saved_at,
            app_version,
        } = previous.into_upgrade_parts()?;
        Ok(Self {
            project_id,
            workspace: serde_json::from_value(workspace).map_err(|error| {
                app_error(
                    ErrorCode::ProjectMigrationFailed,
                    format!("Failed to migrate the V4 workspace to V5: {error}"),
                )
            })?,
            saved_at,
            app_version,
        })
    }
}

impl CurrentProjectModel for Model {
    fn from_runtime(
        workspace: &ProjectWorkspace,
        saved_at: u64,
        app_version: &str,
    ) -> AppResult<Self> {
        let value = serde_json::to_value(workspace).map_err(|error| {
            app_error(
                ErrorCode::ProjectEncodeFailed,
                format!("Failed to serialize the runtime project state: {error}"),
            )
        })?;
        Ok(Self {
            // The `from_runtime` facade stamps a real id via `set_project_id`.
            project_id: String::new(),
            workspace: serde_json::from_value(value).map_err(|error| {
                app_error(
                    ErrorCode::ProjectEncodeFailed,
                    format!("Runtime project state is incompatible with the V5 model: {error}"),
                )
            })?,
            saved_at,
            app_version: app_version.to_string(),
        })
    }

    fn into_runtime(self) -> AppResult<ProjectWorkspace> {
        let value = serde_json::to_value(self.workspace).map_err(|error| {
            app_error(
                ErrorCode::ProjectDecodeFailed,
                format!("Failed to serialize the V5 project model for runtime conversion: {error}"),
            )
        })?;
        serde_json::from_value(value).map_err(|error| {
            app_error(
                ErrorCode::ProjectDecodeFailed,
                format!("The V5 project model is incompatible with runtime state: {error}"),
            )
        })
    }

    fn project_id(&self) -> &str {
        &self.project_id
    }

    fn set_project_id(&mut self, project_id: &str) {
        self.project_id = project_id.to_string();
    }
}
