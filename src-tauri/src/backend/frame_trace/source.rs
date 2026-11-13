use crate::backend::{parse_frame_rate, DEFAULT_MEDIA_FRAME_RATE};
use crate::{app_error, AppResult, ErrorCode};

pub(super) struct FrameTraceSource {
    pub(super) path: String,
    pub(super) fingerprint: String,
    pub(super) stream_index: i32,
    pub(super) frame_count: i64,
    pub(super) frame_rate: f64,
}

pub(super) fn frame_trace_source(
    asset_id: &str,
    start_frame: i64,
    end_frame: i64,
    media_sources: &crate::MediaSources,
) -> AppResult<FrameTraceSource> {
    let frame_count = end_frame
        .checked_sub(start_frame)
        .and_then(|n| n.checked_add(1))
        .filter(|n| start_frame >= 0 && *n > 0)
        .ok_or_else(|| {
            app_error(
                ErrorCode::StoryboardMotionRangeInvalid,
                "Invalid frame trace range",
            )
        })?;
    let project = media_sources.get(asset_id)?;
    let stream_index = project.asset.video_stream_index.ok_or_else(|| {
        app_error(
            ErrorCode::VideoStreamMissing,
            "Media asset has no video stream",
        )
    })?;
    let frame_rate = project
        .streams
        .iter()
        .find(|stream| stream.index == stream_index)
        .and_then(|stream| {
            parse_frame_rate(stream.avg_frame_rate.as_deref())
                .or_else(|| parse_frame_rate(stream.r_frame_rate.as_deref()))
        })
        .unwrap_or(DEFAULT_MEDIA_FRAME_RATE);
    Ok(FrameTraceSource {
        path: project.asset.path.clone(),
        fingerprint: project.asset.fingerprint.clone(),
        stream_index,
        frame_count,
        frame_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(avg: Option<&str>, real: Option<&str>) -> crate::MediaSources {
        serde_json::from_value(serde_json::json!({
            "a": {
                "asset": {
                    "id": "a",
                    "path": "clip.mp4",
                    "file_name": "clip.mp4",
                    "file_size": 1,
                    "modified_at": 0,
                    "fingerprint": "hash",
                    "duration_us": 1_000_000,
                    "start_time_us": 0,
                    "video_stream_index": 0,
                    "audio_stream_index": null
                },
                "streams": [{
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "avg_frame_rate": avg,
                    "r_frame_rate": real,
                    "language": null,
                    "title": null,
                    "width": 1920,
                    "height": 1080,
                    "channels": null,
                    "disposition": {}
                }],
                "tracks": [],
                "cues": {},
                "cache_dir": "cache",
                "proxy_path": null
            }
        }))
        .unwrap()
    }

    #[test]
    fn missing_frame_rate_falls_back_to_24() {
        let source = frame_trace_source("a", 0, 0, &sources(Some("0/0"), None)).unwrap();
        assert_eq!(source.frame_rate, 24.0);
        let source = frame_trace_source("a", 0, 0, &sources(None, Some("24000/1001"))).unwrap();
        assert!((source.frame_rate - (24_000.0 / 1001.0)).abs() < 1e-9);
    }
}
