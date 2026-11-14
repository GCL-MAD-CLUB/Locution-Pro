use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranscodeScaling {
    #[default]
    Fit,
    Fill,
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranscodeRateControl {
    /// Leave rate control to the encoder (ProRes, DNxHR, lossless codecs).
    Auto,
    #[default]
    Quality,
    Vbr,
    Cbr,
    TwoPass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranscodeAudioTracks {
    #[default]
    All,
    First,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranscodeSubtitleMode {
    /// Keep the subtitle streams in the output container without re-encoding.
    #[default]
    Copy,
    /// Re-encode the subtitle streams into the output container.
    Convert,
    /// Render one subtitle stream into the picture.
    Burn,
    /// Write each subtitle stream to its own file next to the output.
    Sidecar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranscodeOverlayPosition {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    #[default]
    BottomCenter,
    BottomRight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TranscodeTextContent {
    None,
    #[default]
    SourceName,
    OutputName,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeVideoSettings {
    /// FFmpeg encoder name, or `copy` to keep the source stream.
    pub(crate) codec: String,
    pub(crate) width: Option<i64>,
    pub(crate) height: Option<i64>,
    pub(crate) scaling: TranscodeScaling,
    /// Rational or decimal frames per second; `None` keeps the source rate.
    pub(crate) frame_rate: Option<String>,
    pub(crate) pixel_format: Option<String>,
    pub(crate) profile: Option<String>,
    pub(crate) level: Option<String>,
    pub(crate) speed_preset: Option<String>,
    pub(crate) rate_control: TranscodeRateControl,
    pub(crate) quality: f64,
    pub(crate) bitrate_kbps: i64,
    /// Zero leaves the peak rate to the encoder.
    pub(crate) max_bitrate_kbps: i64,
    pub(crate) keyframe_interval: Option<i64>,
    pub(crate) deinterlace: bool,
}

impl Default for TranscodeVideoSettings {
    fn default() -> Self {
        Self {
            codec: "libx264".to_string(),
            width: None,
            height: None,
            scaling: TranscodeScaling::Fit,
            frame_rate: None,
            pixel_format: Some("yuv420p".to_string()),
            profile: None,
            level: None,
            speed_preset: None,
            rate_control: TranscodeRateControl::Quality,
            quality: 20.0,
            bitrate_kbps: 10_000,
            max_bitrate_kbps: 0,
            keyframe_interval: None,
            deinterlace: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeAudioSettings {
    /// FFmpeg encoder name, or `copy` to keep the source streams.
    pub(crate) codec: String,
    pub(crate) sample_rate: Option<i64>,
    pub(crate) channels: Option<i64>,
    pub(crate) bitrate_kbps: Option<i64>,
    pub(crate) tracks: TranscodeAudioTracks,
}

impl Default for TranscodeAudioSettings {
    fn default() -> Self {
        Self {
            codec: "aac".to_string(),
            sample_rate: None,
            channels: None,
            bitrate_kbps: Some(320),
            tracks: TranscodeAudioTracks::All,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeSubtitleSettings {
    pub(crate) mode: TranscodeSubtitleMode,
    /// FFmpeg subtitle encoder used by the convert and sidecar modes.
    pub(crate) codec: String,
    /// File extension of sidecar subtitle files.
    pub(crate) sidecar_extension: String,
    /// Zero-based index among the source subtitle streams; `None` selects all
    /// suitable streams, or the first one where a single stream is required.
    pub(crate) stream: Option<usize>,
    /// Optional subtitle file used instead of the embedded streams.
    pub(crate) external_path: String,
}

impl Default for TranscodeSubtitleSettings {
    fn default() -> Self {
        Self {
            mode: TranscodeSubtitleMode::Copy,
            codec: "subrip".to_string(),
            sidecar_extension: "srt".to_string(),
            stream: None,
            external_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeToneMapping {
    pub(crate) enabled: bool,
    pub(crate) algorithm: String,
}

impl Default for TranscodeToneMapping {
    fn default() -> Self {
        Self {
            enabled: false,
            algorithm: "hable".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeLut {
    pub(crate) enabled: bool,
    pub(crate) path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeImageOverlay {
    pub(crate) enabled: bool,
    pub(crate) path: String,
    pub(crate) position: TranscodeOverlayPosition,
    pub(crate) offset_x: i64,
    pub(crate) offset_y: i64,
    pub(crate) scale_percent: f64,
    pub(crate) opacity_percent: f64,
}

impl Default for TranscodeImageOverlay {
    fn default() -> Self {
        Self {
            enabled: false,
            path: String::new(),
            position: TranscodeOverlayPosition::Center,
            offset_x: 0,
            offset_y: 0,
            scale_percent: 100.0,
            opacity_percent: 100.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeTextOverlay {
    pub(crate) enabled: bool,
    pub(crate) prefix: String,
    pub(crate) content: TranscodeTextContent,
    pub(crate) suffix: String,
    pub(crate) position: TranscodeOverlayPosition,
    /// Font height as a percentage of the frame height.
    pub(crate) size_percent: f64,
    pub(crate) opacity_percent: f64,
}

impl Default for TranscodeTextOverlay {
    fn default() -> Self {
        Self {
            enabled: false,
            prefix: String::new(),
            content: TranscodeTextContent::SourceName,
            suffix: String::new(),
            position: TranscodeOverlayPosition::TopCenter,
            size_percent: 4.0,
            opacity_percent: 100.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeTimecodeOverlay {
    pub(crate) enabled: bool,
    pub(crate) position: TranscodeOverlayPosition,
    pub(crate) size_percent: f64,
    pub(crate) opacity_percent: f64,
}

impl Default for TranscodeTimecodeOverlay {
    fn default() -> Self {
        Self {
            enabled: false,
            position: TranscodeOverlayPosition::BottomCenter,
            size_percent: 4.0,
            opacity_percent: 100.0,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeTimeTuner {
    pub(crate) enabled: bool,
    /// Change of the output duration, -10 to +10 percent.
    pub(crate) duration_change_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeVideoLimiter {
    pub(crate) enabled: bool,
    /// Clip level in IRE, 100 to 109.
    pub(crate) clip_level_ire: f64,
}

impl Default for TranscodeVideoLimiter {
    fn default() -> Self {
        Self {
            enabled: false,
            clip_level_ire: 103.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeLoudness {
    pub(crate) enabled: bool,
    pub(crate) target_lufs: f64,
    pub(crate) range_lu: f64,
    pub(crate) true_peak_db: f64,
}

impl Default for TranscodeLoudness {
    fn default() -> Self {
        Self {
            enabled: false,
            target_lufs: -24.0,
            range_lu: 7.0,
            true_peak_db: -2.0,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeEffects {
    pub(crate) tone_mapping: TranscodeToneMapping,
    pub(crate) lut: TranscodeLut,
    pub(crate) image_overlay: TranscodeImageOverlay,
    pub(crate) text_overlay: TranscodeTextOverlay,
    pub(crate) timecode_overlay: TranscodeTimecodeOverlay,
    pub(crate) time_tuner: TranscodeTimeTuner,
    pub(crate) video_limiter: TranscodeVideoLimiter,
    pub(crate) loudness: TranscodeLoudness,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct TranscodeSettings {
    /// FFmpeg muxer name.
    pub(crate) container: String,
    pub(crate) extension: String,
    pub(crate) export_video: bool,
    pub(crate) export_audio: bool,
    pub(crate) export_subtitles: bool,
    pub(crate) comment: String,
    pub(crate) video: TranscodeVideoSettings,
    pub(crate) audio: TranscodeAudioSettings,
    pub(crate) subtitles: TranscodeSubtitleSettings,
    pub(crate) fast_start: bool,
    pub(crate) effects: TranscodeEffects,
    pub(crate) range_start_us: Option<i64>,
    pub(crate) range_end_us: Option<i64>,
    pub(crate) hardware_decode: bool,
    /// Additional FFmpeg output options, appended before the output path.
    pub(crate) extra_args: String,
}

impl Default for TranscodeSettings {
    fn default() -> Self {
        Self {
            container: "mp4".to_string(),
            extension: "mp4".to_string(),
            export_video: true,
            export_audio: true,
            export_subtitles: true,
            comment: String::new(),
            video: TranscodeVideoSettings::default(),
            audio: TranscodeAudioSettings::default(),
            subtitles: TranscodeSubtitleSettings::default(),
            fast_start: true,
            effects: TranscodeEffects::default(),
            range_start_us: None,
            range_end_us: None,
            hardware_decode: false,
            extra_args: String::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeJob {
    pub(crate) input_path: String,
    pub(crate) output_dir: String,
    /// Output file name without its extension.
    pub(crate) output_name: String,
    #[serde(default)]
    pub(crate) overwrite: bool,
    pub(crate) settings: TranscodeSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeResult {
    pub(crate) output_path: String,
    pub(crate) sidecar_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeCodecEntry {
    pub(crate) name: String,
    pub(crate) description: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeCapabilities {
    pub(crate) version: String,
    pub(crate) muxers: Vec<TranscodeCodecEntry>,
    pub(crate) video_encoders: Vec<TranscodeCodecEntry>,
    pub(crate) audio_encoders: Vec<TranscodeCodecEntry>,
    pub(crate) subtitle_encoders: Vec<TranscodeCodecEntry>,
    pub(crate) filters: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeCodecDetails {
    pub(crate) name: String,
    pub(crate) extensions: Vec<String>,
    pub(crate) default_video_codec: Option<String>,
    pub(crate) default_audio_codec: Option<String>,
    pub(crate) default_subtitle_codec: Option<String>,
    pub(crate) pixel_formats: Vec<String>,
    pub(crate) sample_rates: Vec<i64>,
    pub(crate) channel_layouts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeSourceStream {
    /// Zero-based index among the streams of the same type.
    pub(crate) index: usize,
    pub(crate) codec: String,
    pub(crate) language: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) width: Option<i64>,
    pub(crate) height: Option<i64>,
    pub(crate) frame_rate: Option<String>,
    pub(crate) sample_rate: Option<i64>,
    pub(crate) channels: Option<i64>,
    pub(crate) bitmap: bool,
    /// Transfer characteristic reported by the source, e.g. `smpte2084`.
    pub(crate) color_transfer: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscodeSourceInfo {
    pub(crate) duration_us: i64,
    pub(crate) video: Vec<TranscodeSourceStream>,
    pub(crate) audio: Vec<TranscodeSourceStream>,
    pub(crate) subtitles: Vec<TranscodeSourceStream>,
}
