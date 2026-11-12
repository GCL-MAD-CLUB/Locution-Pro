use super::UserNotice;
use crate::error::{app_error, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MediaAsset {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) file_size: i64,
    pub(crate) modified_at: i64,
    pub(crate) fingerprint: String,
    pub(crate) duration_us: i64,
    pub(crate) start_time_us: i64,
    #[serde(default)]
    pub(crate) tape_name: Option<String>,
    pub(crate) video_stream_index: Option<i32>,
    pub(crate) audio_stream_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MediaStream {
    pub(crate) index: i32,
    pub(crate) codec_type: String,
    pub(crate) codec_name: String,
    #[serde(default)]
    pub(crate) avg_frame_rate: Option<String>,
    #[serde(default)]
    pub(crate) r_frame_rate: Option<String>,
    #[serde(default)]
    pub(crate) sample_aspect_ratio: Option<String>,
    #[serde(default)]
    pub(crate) sample_rate: Option<String>,
    #[serde(default)]
    pub(crate) channel_layout: Option<String>,
    pub(crate) language: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) width: Option<i64>,
    pub(crate) height: Option<i64>,
    pub(crate) channels: Option<i64>,
    pub(crate) disposition: HashMap<String, i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SubtitleSourceType {
    Embedded,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SubtitleKind {
    Text,
    Bitmap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SubtitleTrack {
    pub(crate) id: String,
    pub(crate) asset_id: String,
    pub(crate) source_type: SubtitleSourceType,
    pub(crate) stream_index: Option<i32>,
    pub(crate) source_path: Option<String>,
    pub(crate) codec: String,
    pub(crate) language: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) kind: SubtitleKind,
    pub(crate) offset_us: i64,
    pub(crate) cue_count: usize,
    pub(crate) warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SubtitleCue {
    pub(crate) id: String,
    pub(crate) track_id: String,
    pub(crate) sequence: i32,
    pub(crate) start_us: i64,
    pub(crate) end_us: i64,
    pub(crate) raw_text: String,
    pub(crate) plain_text: String,
    pub(crate) speaker: Option<String>,
    pub(crate) style: Option<String>,
    pub(crate) layer: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct MediaDocument {
    pub(crate) asset: MediaAsset,
    pub(crate) streams: Vec<MediaStream>,
    pub(crate) tracks: Vec<SubtitleTrack>,
    pub(crate) cues: HashMap<String, Vec<SubtitleCue>>,
    pub(crate) cache_dir: String,
    pub(crate) proxy_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct AddExternalSubtitlesResult {
    pub(crate) tracks: Vec<SubtitleTrack>,
    pub(crate) cues: HashMap<String, Vec<SubtitleCue>>,
    pub(crate) warnings: Vec<UserNotice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DemuxedAudioTrack {
    pub(crate) file_name: String,
    pub(crate) duration_us: i64,
    pub(crate) stream_index: i32,
    pub(crate) codec: String,
    pub(crate) language: Option<String>,
    pub(crate) title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DemuxMediaResult {
    pub(crate) audio_tracks: Vec<DemuxedAudioTrack>,
    pub(crate) subtitle_tracks: Vec<SubtitleTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ImportResult {
    pub(crate) project: MediaDocument,
    pub(crate) warnings: Vec<UserNotice>,
}

/// Immutable input for one native operation, supplied by the authoritative document.
/// Never retained in AppState or written back by a background task.
#[derive(Debug, Clone, Deserialize)]
#[serde(transparent)]
pub(crate) struct MediaSources(pub(crate) HashMap<String, MediaDocument>);

impl MediaSources {
    pub(crate) fn get(&self, asset_id: &str) -> AppResult<&MediaDocument> {
        self.0
            .get(asset_id)
            .filter(|media| media.asset.id == asset_id)
            .ok_or_else(|| {
                app_error(
                    ErrorCode::MediaNotFound,
                    format!("Media asset missing from operation input: {asset_id}"),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(path: &str) -> MediaSources {
        serde_json::from_value(serde_json::json!({"a": {
            "asset": {"id":"a", "path":path, "file_name":"a.mp4", "file_size":0,
                "modified_at":0, "fingerprint":"hash", "duration_us":100,
                "start_time_us":0, "video_stream_index":0, "audio_stream_index":null},
            "streams":[], "tracks":[], "cues":{}, "cache_dir":"cache", "proxy_path":null
        }}))
        .unwrap()
    }

    #[test]
    fn operation_inputs_are_independent_and_missing_media_fails_closed() {
        let original = source("original.mp4");
        let relinked = source("relinked.mp4");
        assert_eq!(original.get("a").unwrap().asset.path, "original.mp4");
        assert_eq!(relinked.get("a").unwrap().asset.path, "relinked.mp4");
        assert!(MediaSources(HashMap::new()).get("a").is_err());
        let mut mismatched = original.clone();
        mismatched.0.get_mut("a").unwrap().asset.id = "b".into();
        assert!(mismatched.get("a").is_err());
    }
}
