//! Standalone media transcoding: FFmpeg capability discovery, argument
//! planning, and the queued transcode command.
use super::*;

const TRANSCODE_CONFIG_FILE_NAME: &str = "TranscodeConfig.json";
const TRANSCODE_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSCODE_LISTING_TIMEOUT: Duration = Duration::from_secs(20);

const BITMAP_SUBTITLE_CODECS: &[&str] = &[
    "hdmv_pgs_subtitle",
    "dvd_subtitle",
    "dvb_subtitle",
    "dvb_teletext",
    "xsub",
];
const BITMAP_SUBTITLE_ENCODERS: &[&str] = &["dvdsub", "dvbsub", "xsub"];
/// Muxers that hold exactly one subtitle stream and nothing else.
const SUBTITLE_FILE_MUXERS: &[&str] = &[
    "srt", "ass", "webvtt", "ttml", "sup", "microdvd", "lrc", "jacosub", "scc", "mcc",
];
/// Muxers that hold exactly one audio stream.
const SINGLE_AUDIO_MUXERS: &[&str] = &[
    "mp3", "wav", "flac", "adts", "ac3", "eac3", "aiff", "au", "w64", "mp2", "amr", "dts",
    "truehd", "opus", "oga", "spx", "tta", "wv", "ipod", "caf", "latm", "voc", "ast", "rf64",
];
const FAST_START_MUXERS: &[&str] = &["mp4", "mov", "ipod", "m4v", "3gp", "3g2", "psp", "f4v"];
const HVC1_TAG_MUXERS: &[&str] = &["mp4", "mov", "ipod", "m4v"];
const TWO_PASS_ENCODERS: &[&str] = &[
    "libx264",
    "libx264rgb",
    "libvpx",
    "libvpx-vp9",
    "mpeg4",
    "libxvid",
    "mpeg2video",
    "mpeg1video",
];

fn invalid_settings(detail: impl Into<String>) -> AppError {
    app_error(ErrorCode::TranscodeSettingsInvalid, detail.into())
}

/// Accepts FFmpeg identifiers (codec, muxer, pixel format, preset...) only, so
/// a setting can never be read as another command-line option.
fn validate_token(value: &str, role: &str) -> AppResult<()> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && !value.starts_with('-')
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '+'));
    if valid {
        Ok(())
    } else {
        Err(invalid_settings(format!(
            "Transcode {role} is not a valid FFmpeg identifier"
        )))
    }
}

fn validate_optional_token(value: &Option<String>, role: &str) -> AppResult<()> {
    match value.as_deref() {
        Some(value) => validate_token(value, role),
        None => Ok(()),
    }
}

fn validate_frame_rate(value: &str) -> AppResult<()> {
    let valid = !value.is_empty()
        && value.len() <= 24
        && value
            .chars()
            .all(|ch| ch.is_ascii_digit() || matches!(ch, '/' | '.'))
        && value.chars().filter(|ch| *ch == '/').count() <= 1
        && value.chars().any(|ch| ch.is_ascii_digit());
    if valid {
        Ok(())
    } else {
        Err(invalid_settings("Transcode frame rate is not a number"))
    }
}

fn validate_transcode_settings(settings: &TranscodeSettings) -> AppResult<()> {
    validate_token(&settings.container, "container")?;
    validate_token(&settings.extension, "extension")?;
    validate_token(&settings.video.codec, "video codec")?;
    validate_token(&settings.audio.codec, "audio codec")?;
    validate_token(&settings.subtitles.codec, "subtitle codec")?;
    validate_token(&settings.subtitles.sidecar_extension, "subtitle extension")?;
    validate_token(&settings.effects.tone_mapping.algorithm, "tone mapping")?;
    validate_optional_token(&settings.video.pixel_format, "pixel format")?;
    validate_optional_token(&settings.video.profile, "profile")?;
    validate_optional_token(&settings.video.level, "level")?;
    validate_optional_token(&settings.video.speed_preset, "speed preset")?;
    if let Some(frame_rate) = settings.video.frame_rate.as_deref() {
        validate_frame_rate(frame_rate)?;
    }
    for (value, role) in [
        (settings.video.width, "width"),
        (settings.video.height, "height"),
        (settings.video.keyframe_interval, "keyframe interval"),
        (settings.audio.sample_rate, "sample rate"),
        (settings.audio.channels, "channel count"),
    ] {
        if value.is_some_and(|value| !(1..=1_000_000).contains(&value)) {
            return Err(invalid_settings(format!(
                "Transcode {role} is out of range"
            )));
        }
    }
    if !settings.export_video && !settings.export_audio && !settings.export_subtitles {
        return Err(invalid_settings(
            "Transcode settings export no video, audio or subtitles",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EncoderFamily {
    X26x,
    Vpx,
    SvtAv1,
    Aom,
    Rav1e,
    VideoToolbox,
    Nvenc,
    Qsv,
    Amf,
    Generic,
}

fn encoder_family(codec: &str) -> EncoderFamily {
    match codec {
        "libx264" | "libx264rgb" | "libx265" => EncoderFamily::X26x,
        "libvpx" | "libvpx-vp9" => EncoderFamily::Vpx,
        "libsvtav1" => EncoderFamily::SvtAv1,
        "libaom-av1" => EncoderFamily::Aom,
        "librav1e" => EncoderFamily::Rav1e,
        _ if codec.ends_with("_videotoolbox") => EncoderFamily::VideoToolbox,
        _ if codec.ends_with("_nvenc") => EncoderFamily::Nvenc,
        _ if codec.ends_with("_qsv") => EncoderFamily::Qsv,
        _ if codec.ends_with("_amf") => EncoderFamily::Amf,
        _ => EncoderFamily::Generic,
    }
}

fn is_hevc_encoder(codec: &str) -> bool {
    codec.contains("265") || codec.contains("hevc")
}

fn seconds_arg(microseconds: i64) -> String {
    format!("{:.6}", microseconds.max(0) as f64 / 1_000_000.0)
}

fn number_arg(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        let text = format!("{value:.3}");
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn even_dimension(value: i64) -> i64 {
    let value = value.max(2);
    value - value % 2
}

/// Quotes a file path for use as a filter option value inside a filtergraph.
pub(crate) fn escape_filter_path(path: &str) -> String {
    let option_level = path
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'");
    format!("'{}'", option_level.replace('\'', "'\\''"))
}

fn pixel_format_depth(pixel_format: Option<&str>) -> u32 {
    let Some(pixel_format) = pixel_format else {
        return 8;
    };
    for depth in [16_u32, 14, 12, 10, 9] {
        if pixel_format.contains(&depth.to_string()) {
            return depth;
        }
    }
    8
}

fn position_expressions(
    position: TranscodeOverlayPosition,
    frame: (&str, &str),
    object: (&str, &str),
    margin: &str,
    offset: (i64, i64),
) -> (String, String) {
    use TranscodeOverlayPosition as Position;
    let (frame_width, frame_height) = frame;
    let (object_width, object_height) = object;
    let left = format!("{margin}+({})", offset.0);
    let center_x = format!("({frame_width}-{object_width})/2+({})", offset.0);
    let right = format!("{frame_width}-{object_width}-{margin}+({})", offset.0);
    let top = format!("{margin}+({})", offset.1);
    let center_y = format!("({frame_height}-{object_height})/2+({})", offset.1);
    let bottom = format!("{frame_height}-{object_height}-{margin}+({})", offset.1);
    let x = match position {
        Position::TopLeft | Position::CenterLeft | Position::BottomLeft => left,
        Position::TopCenter | Position::Center | Position::BottomCenter => center_x,
        Position::TopRight | Position::CenterRight | Position::BottomRight => right,
    };
    let y = match position {
        Position::TopLeft | Position::TopCenter | Position::TopRight => top,
        Position::CenterLeft | Position::Center | Position::CenterRight => center_y,
        Position::BottomLeft | Position::BottomCenter | Position::BottomRight => bottom,
    };
    (x, y)
}

fn opacity_arg(percent: f64) -> String {
    number_arg((percent.clamp(0.0, 100.0) / 100.0 * 1000.0).round() / 1000.0)
}

fn draw_text_filter(
    source: &str,
    font_file: Option<&str>,
    position: TranscodeOverlayPosition,
    size_percent: f64,
    opacity_percent: f64,
) -> String {
    let (x, y) = position_expressions(position, ("w", "h"), ("tw", "th"), "h*0.03", (0, 0));
    let size = number_arg(size_percent.clamp(1.0, 50.0));
    let opacity = opacity_arg(opacity_percent);
    let font = font_file
        .map(|path| format!(":fontfile={}", escape_filter_path(path)))
        .unwrap_or_default();
    format!(
        "drawtext={source}{font}:fontsize=h*{size}/100:fontcolor=white@{opacity}:shadowcolor=black@{opacity}:shadowx=2:shadowy=2:x={x}:y={y}"
    )
}

/// The HDR transfer to tone-map from: the source's own PQ or HLG tag, PQ
/// (HDR10) when the source does not say, and `None` for a tagged SDR source,
/// which needs no tone mapping.
fn tone_mapping_input_transfer(transfer: Option<&str>) -> Option<&'static str> {
    match transfer.map(str::trim) {
        Some("smpte2084") => Some("smpte2084"),
        Some("arib-std-b67") => Some("arib-std-b67"),
        None | Some("") | Some("unknown") | Some("unspecified") => Some("smpte2084"),
        Some(_) => None,
    }
}

/// Splits user-supplied extra options like a shell would, honoring quotes.
pub(crate) fn split_extra_args(value: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut pending = false;
    for ch in value.chars() {
        match quote {
            Some(active) if ch == active => quote = None,
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
                pending = true;
            }
            None if ch.is_whitespace() => {
                if pending || !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                    pending = false;
                }
            }
            None => current.push(ch),
        }
    }
    if pending || !current.is_empty() {
        args.push(current);
    }
    args
}

/// Which codec a copied subtitle stream gets in the target container:
/// `copy` when the container holds it, a text conversion when it does not,
/// or `None` for a bitmap stream the container cannot hold.
fn copied_subtitle_codec(container: &str, codec: Option<&str>, bitmap: bool) -> Option<String> {
    let mp4_family = HVC1_TAG_MUXERS.contains(&container) || FAST_START_MUXERS.contains(&container);
    let target = if mp4_family {
        "mov_text"
    } else if container == "webm" {
        "webvtt"
    } else if container == "matroska" {
        // Matroska holds every subtitle codec except MP4's timed text.
        if codec == Some("mov_text") {
            return Some("subrip".to_string());
        }
        return Some("copy".to_string());
    } else {
        return Some("copy".to_string());
    };
    if codec == Some(target) {
        Some("copy".to_string())
    } else if bitmap {
        None
    } else {
        Some(target.to_string())
    }
}

enum SubtitlePlan {
    None,
    /// `(input index, stream specifier, codec)` for every muxed stream.
    Mux {
        streams: Vec<(usize, String, String)>,
    },
    BurnText {
        file: String,
        stream: Option<usize>,
    },
    BurnBitmap {
        stream: usize,
    },
    Sidecar {
        streams: Vec<usize>,
    },
}

pub(crate) struct TranscodePlan {
    pub(crate) passes: Vec<Vec<String>>,
    pub(crate) sidecar_paths: Vec<PathBuf>,
    /// Text files the filters read; written before FFmpeg starts.
    pub(crate) temp_files: Vec<(PathBuf, String)>,
    pub(crate) duration_us: i64,
}

fn sidecar_path(output_path: &Path, stream: &TranscodeSourceStream, extension: &str) -> PathBuf {
    let stem = output_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".to_string());
    let tag = stream
        .language
        .as_deref()
        .map(str::trim)
        .filter(|language| !language.is_empty() && *language != "und")
        .map(|language| format!("{}.{language}", stream.index + 1))
        .unwrap_or_else(|| (stream.index + 1).to_string());
    output_path.with_file_name(format!("{}.{tag}.{extension}", safe_component(&stem)))
}

fn plan_subtitles(
    settings: &TranscodeSettings,
    source: &TranscodeSourceInfo,
    external_input: Option<usize>,
    video_enabled: bool,
) -> AppResult<SubtitlePlan> {
    let subtitles = &settings.subtitles;
    if !settings.export_subtitles {
        return Ok(SubtitlePlan::None);
    }
    let external = subtitles.external_path.trim();
    let single_stream = SUBTITLE_FILE_MUXERS.contains(&settings.container.as_str());
    let selected = |candidates: Vec<&TranscodeSourceStream>| -> Vec<usize> {
        let mut indexes: Vec<usize> = match subtitles.stream {
            Some(wanted) => candidates
                .iter()
                .filter(|stream| stream.index == wanted)
                .map(|stream| stream.index)
                .collect(),
            None => candidates.iter().map(|stream| stream.index).collect(),
        };
        if single_stream {
            indexes.truncate(1);
        }
        indexes
    };
    match subtitles.mode {
        TranscodeSubtitleMode::Copy | TranscodeSubtitleMode::Convert => {
            let copy = subtitles.mode == TranscodeSubtitleMode::Copy;
            let container = settings.container.as_str();
            if let Some(input) = external_input {
                // External subtitle files are text (SRT, ASS, VTT...).
                let codec = if copy {
                    copied_subtitle_codec(container, None, false)
                        .unwrap_or_else(|| "copy".to_string())
                } else {
                    subtitles.codec.clone()
                };
                return Ok(SubtitlePlan::Mux {
                    streams: vec![(input, "s:0".to_string(), codec)],
                });
            }
            let bitmap_target = BITMAP_SUBTITLE_ENCODERS.contains(&subtitles.codec.as_str());
            let candidates = source
                .subtitles
                .iter()
                .filter(|stream| {
                    if copy {
                        copied_subtitle_codec(container, Some(&stream.codec), stream.bitmap)
                            .is_some()
                    } else {
                        stream.bitmap == bitmap_target
                    }
                })
                .collect();
            let streams: Vec<(usize, String, String)> = selected(candidates)
                .into_iter()
                .filter_map(|index| {
                    let stream = source
                        .subtitles
                        .iter()
                        .find(|stream| stream.index == index)?;
                    let codec = if copy {
                        copied_subtitle_codec(container, Some(&stream.codec), stream.bitmap)?
                    } else {
                        subtitles.codec.clone()
                    };
                    Some((0, format!("s:{index}"), codec))
                })
                .collect();
            if streams.is_empty() {
                Ok(SubtitlePlan::None)
            } else {
                Ok(SubtitlePlan::Mux { streams })
            }
        }
        TranscodeSubtitleMode::Burn => {
            if !video_enabled {
                return Ok(SubtitlePlan::None);
            }
            if !external.is_empty() {
                return Ok(SubtitlePlan::BurnText {
                    file: external.to_string(),
                    stream: None,
                });
            }
            let stream = match subtitles.stream {
                Some(wanted) => source
                    .subtitles
                    .iter()
                    .find(|stream| stream.index == wanted),
                None => source.subtitles.first(),
            };
            Ok(match stream {
                Some(stream) if stream.bitmap => SubtitlePlan::BurnBitmap {
                    stream: stream.index,
                },
                Some(stream) => SubtitlePlan::BurnText {
                    file: String::new(),
                    stream: Some(stream.index),
                },
                None => SubtitlePlan::None,
            })
        }
        TranscodeSubtitleMode::Sidecar => {
            let bitmap_target = BITMAP_SUBTITLE_ENCODERS.contains(&subtitles.codec.as_str());
            let candidates = source
                .subtitles
                .iter()
                .filter(|stream| stream.bitmap == bitmap_target)
                .collect();
            let streams = selected(candidates);
            if streams.is_empty() {
                Ok(SubtitlePlan::None)
            } else {
                Ok(SubtitlePlan::Sidecar { streams })
            }
        }
    }
}

fn video_codec_args(settings: &TranscodeSettings, two_pass: bool) -> Vec<String> {
    let video = &settings.video;
    let codec = video.codec.as_str();
    let family = encoder_family(codec);
    let mut args = vec!["-c:v".to_string(), codec.to_string()];
    let mut push = |values: &[String]| args.extend(values.iter().cloned());
    let kbps = |value: i64| format!("{}k", value.max(1));
    let quality = number_arg(video.quality);

    if let Some(preset) = video.speed_preset.as_deref() {
        match family {
            EncoderFamily::Vpx => push(&[
                "-deadline".to_string(),
                "good".to_string(),
                "-cpu-used".to_string(),
                preset.to_string(),
            ]),
            EncoderFamily::Aom => push(&["-cpu-used".to_string(), preset.to_string()]),
            EncoderFamily::Rav1e => push(&["-speed".to_string(), preset.to_string()]),
            EncoderFamily::Amf => push(&["-quality".to_string(), preset.to_string()]),
            EncoderFamily::VideoToolbox | EncoderFamily::Generic => {}
            EncoderFamily::X26x
            | EncoderFamily::SvtAv1
            | EncoderFamily::Nvenc
            | EncoderFamily::Qsv => push(&["-preset".to_string(), preset.to_string()]),
        }
    }
    if codec == "libvpx-vp9" {
        push(&["-row-mt".to_string(), "1".to_string()]);
    }
    if let Some(profile) = video.profile.as_deref() {
        push(&["-profile:v".to_string(), profile.to_string()]);
    }
    if let Some(level) = video.level.as_deref() {
        push(&["-level".to_string(), level.to_string()]);
    }

    let rate_control = if two_pass {
        TranscodeRateControl::TwoPass
    } else if video.rate_control == TranscodeRateControl::TwoPass {
        // The encoder cannot run two passes; keep the requested bitrate.
        TranscodeRateControl::Vbr
    } else {
        video.rate_control
    };
    match rate_control {
        TranscodeRateControl::Auto => {}
        TranscodeRateControl::Quality => match family {
            EncoderFamily::X26x | EncoderFamily::SvtAv1 => push(&["-crf".to_string(), quality]),
            EncoderFamily::Vpx | EncoderFamily::Aom => push(&[
                "-crf".to_string(),
                quality,
                "-b:v".to_string(),
                "0".to_string(),
            ]),
            EncoderFamily::Rav1e => push(&["-qp".to_string(), quality]),
            EncoderFamily::Nvenc => push(&[
                "-rc".to_string(),
                "vbr".to_string(),
                "-cq".to_string(),
                quality,
                "-b:v".to_string(),
                "0".to_string(),
            ]),
            EncoderFamily::Qsv => push(&["-global_quality".to_string(), quality]),
            EncoderFamily::Amf => push(&[
                "-rc".to_string(),
                "cqp".to_string(),
                "-qp_i".to_string(),
                quality.clone(),
                "-qp_p".to_string(),
                quality.clone(),
                "-qp_b".to_string(),
                quality,
            ]),
            EncoderFamily::VideoToolbox | EncoderFamily::Generic => {
                push(&["-q:v".to_string(), quality])
            }
        },
        TranscodeRateControl::Vbr | TranscodeRateControl::TwoPass => {
            push(&["-b:v".to_string(), kbps(video.bitrate_kbps)]);
            if video.max_bitrate_kbps > 0 {
                let peak = video.max_bitrate_kbps.max(video.bitrate_kbps);
                push(&[
                    "-maxrate".to_string(),
                    kbps(peak),
                    "-bufsize".to_string(),
                    kbps(peak.saturating_mul(2)),
                ]);
            }
        }
        TranscodeRateControl::Cbr => {
            if matches!(family, EncoderFamily::Nvenc | EncoderFamily::Amf) {
                push(&["-rc".to_string(), "cbr".to_string()]);
            }
            let rate = kbps(video.bitrate_kbps);
            push(&[
                "-b:v".to_string(),
                rate.clone(),
                "-minrate".to_string(),
                rate.clone(),
                "-maxrate".to_string(),
                rate.clone(),
                "-bufsize".to_string(),
                rate,
            ]);
        }
    }

    if let Some(interval) = video.keyframe_interval {
        push(&["-g".to_string(), interval.to_string()]);
    }
    if let Some(pixel_format) = video.pixel_format.as_deref() {
        push(&["-pix_fmt".to_string(), pixel_format.to_string()]);
    }
    if let Some(frame_rate) = video.frame_rate.as_deref() {
        push(&["-r".to_string(), frame_rate.to_string()]);
    }
    if is_hevc_encoder(codec) && HVC1_TAG_MUXERS.contains(&settings.container.as_str()) {
        push(&["-tag:v".to_string(), "hvc1".to_string()]);
    }
    args
}

/// Builds every FFmpeg invocation for one transcode. Pure so the argument
/// contract can be tested without running a media tool.
pub(crate) fn build_transcode_plan(
    job: &TranscodeJob,
    source: &TranscodeSourceInfo,
    output_path: &Path,
    temp_dir: &Path,
    font_file: Option<&str>,
) -> AppResult<TranscodePlan> {
    let settings = &job.settings;
    validate_transcode_settings(settings)?;
    let effects = &settings.effects;
    let video_enabled = settings.export_video && !source.video.is_empty();
    let audio_enabled = settings.export_audio && !source.audio.is_empty();
    let video_copy = settings.video.codec == "copy";
    let audio_copy = settings.audio.codec == "copy";

    let mut inputs: Vec<String> = Vec::new();
    let mut input_count = 1_usize;
    let overlay_input = if video_enabled
        && effects.image_overlay.enabled
        && !effects.image_overlay.path.trim().is_empty()
    {
        input_count += 1;
        Some(input_count - 1)
    } else {
        None
    };
    let external_subtitles = settings.subtitles.external_path.trim();
    let external_subtitle_input = if settings.export_subtitles
        && !external_subtitles.is_empty()
        && matches!(
            settings.subtitles.mode,
            TranscodeSubtitleMode::Copy | TranscodeSubtitleMode::Convert
        ) {
        input_count += 1;
        Some(input_count - 1)
    } else {
        None
    };
    let subtitle_plan = plan_subtitles(settings, source, external_subtitle_input, video_enabled)?;
    if !video_enabled && !audio_enabled && matches!(subtitle_plan, SubtitlePlan::None) {
        return Err(invalid_settings(
            "The source has no stream that the transcode settings export",
        ));
    }

    // Time tuner: the output lasts `stretch` times the source.
    let stretch = if effects.time_tuner.enabled {
        1.0 + effects
            .time_tuner
            .duration_change_percent
            .clamp(-10.0, 10.0)
            / 100.0
    } else {
        1.0
    };
    let retimed = (stretch - 1.0).abs() > f64::EPSILON;

    let range_start_us = settings.range_start_us.unwrap_or(0).max(0);
    let range_end_us = settings
        .range_end_us
        .filter(|end| *end > range_start_us)
        .map(|end| {
            if source.duration_us > 0 {
                end.min(source.duration_us)
            } else {
                end
            }
        });
    let source_span_us = match range_end_us {
        Some(end) => end - range_start_us,
        None => (source.duration_us - range_start_us).max(0),
    };
    let duration_us = ((source_span_us as f64) * stretch).round() as i64;
    let burns_subtitles = matches!(
        subtitle_plan,
        SubtitlePlan::BurnText { .. } | SubtitlePlan::BurnBitmap { .. }
    );
    // Burned subtitles are timed against source timestamps, so the range is
    // applied after decoding rather than by seeking the input.
    let output_seek = burns_subtitles;
    let mut range_input = Vec::new();
    let mut range_output = Vec::new();
    if range_start_us > 0 {
        let target = if output_seek {
            &mut range_output
        } else {
            &mut range_input
        };
        target.extend(["-ss".to_string(), seconds_arg(range_start_us)]);
    }
    if range_end_us.is_some() {
        if output_seek {
            range_output.extend(["-t".to_string(), seconds_arg(duration_us)]);
        } else {
            range_input.extend(["-t".to_string(), seconds_arg(source_span_us)]);
        }
    }

    inputs.extend([
        "-y".to_string(),
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
    ]);
    if settings.hardware_decode && video_enabled && !video_copy {
        inputs.extend(["-hwaccel".to_string(), "auto".to_string()]);
    }
    inputs.extend(range_input);
    inputs.extend(["-i".to_string(), job.input_path.clone()]);
    if overlay_input.is_some() {
        inputs.extend([
            "-i".to_string(),
            effects.image_overlay.path.trim().to_string(),
        ]);
    }
    if external_subtitle_input.is_some() {
        inputs.extend(["-i".to_string(), external_subtitles.to_string()]);
    }

    // Video filters.
    let mut temp_files = Vec::new();
    let mut chain: Vec<String> = Vec::new();
    if video_enabled {
        if settings.video.deinterlace {
            chain.push("bwdif=mode=send_frame:parity=auto:deint=all".to_string());
        }
        if effects.tone_mapping.enabled {
            if let Some(transfer) = tone_mapping_input_transfer(
                source
                    .video
                    .first()
                    .and_then(|stream| stream.color_transfer.as_deref()),
            ) {
                let target = settings.video.pixel_format.as_deref().unwrap_or("yuv420p");
                chain.push(format!(
                    "setparams=color_primaries=bt2020:color_trc={transfer}:colorspace=bt2020nc:range=tv,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap={}:desat=0,zscale=t=bt709:m=bt709:r=tv,format={target}",
                    effects.tone_mapping.algorithm
                ));
            }
        }
        if effects.lut.enabled && !effects.lut.path.trim().is_empty() {
            chain.push(format!(
                "lut3d=file={}",
                escape_filter_path(effects.lut.path.trim())
            ));
        }
        match (settings.video.width, settings.video.height) {
            (Some(width), Some(height)) => {
                let (width, height) = (even_dimension(width), even_dimension(height));
                chain.push(match settings.video.scaling {
                    TranscodeScaling::Fit => format!(
                        "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
                    ),
                    TranscodeScaling::Fill => format!(
                        "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"
                    ),
                    TranscodeScaling::Stretch => format!("scale={width}:{height},setsar=1"),
                });
            }
            (Some(width), None) => chain.push(format!("scale={}:-2", even_dimension(width))),
            (None, Some(height)) => chain.push(format!("scale=-2:{}", even_dimension(height))),
            (None, None) => {}
        }
        if let SubtitlePlan::BurnText { file, stream } = &subtitle_plan {
            let path = if file.is_empty() {
                job.input_path.as_str()
            } else {
                file.as_str()
            };
            let stream = stream
                .map(|index| format!(":si={index}"))
                .unwrap_or_default();
            chain.push(format!(
                "subtitles=filename={}{stream}",
                escape_filter_path(path)
            ));
        }
        if effects.video_limiter.enabled {
            let depth = pixel_format_depth(settings.video.pixel_format.as_deref());
            let scale = f64::from(1_u32 << (depth - 8));
            let ceiling = f64::from((1_u32 << depth) - 1);
            let ire = effects.video_limiter.clip_level_ire.clamp(100.0, 109.0);
            let max = ((16.0 + 219.0 * ire / 100.0) * scale).round().min(ceiling);
            chain.push(format!("limiter=max={}:planes=1", max as i64));
        }
        if retimed {
            chain.push(format!("setpts=PTS*{}", number_arg(stretch)));
        }
        if effects.text_overlay.enabled {
            let source_name = Path::new(&job.input_path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let output_name = output_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let body = match effects.text_overlay.content {
                TranscodeTextContent::None => String::new(),
                TranscodeTextContent::SourceName => source_name,
                TranscodeTextContent::OutputName => output_name,
            };
            let text = format!(
                "{}{body}{}",
                effects.text_overlay.prefix, effects.text_overlay.suffix
            );
            if !text.trim().is_empty() {
                let text_path = temp_dir.join("text-overlay.txt");
                let source = format!(
                    "textfile={}:expansion=none",
                    escape_filter_path(&text_path.to_string_lossy())
                );
                temp_files.push((text_path, text));
                chain.push(draw_text_filter(
                    &source,
                    font_file,
                    effects.text_overlay.position,
                    effects.text_overlay.size_percent,
                    effects.text_overlay.opacity_percent,
                ));
            }
        }
        if effects.timecode_overlay.enabled {
            let rate = settings
                .video
                .frame_rate
                .clone()
                .or_else(|| {
                    source
                        .video
                        .first()
                        .and_then(|stream| stream.frame_rate.clone())
                })
                .filter(|rate| validate_frame_rate(rate).is_ok() && !rate.starts_with("0"))
                .unwrap_or_else(|| "25".to_string());
            chain.push(draw_text_filter(
                &format!("timecode='00\\:00\\:00\\:00':rate={rate}"),
                font_file,
                effects.timecode_overlay.position,
                effects.timecode_overlay.size_percent,
                effects.timecode_overlay.opacity_percent,
            ));
        }
    }
    let bitmap_burn = match subtitle_plan {
        SubtitlePlan::BurnBitmap { stream } if video_enabled => Some(stream),
        _ => None,
    };
    let filtered = !chain.is_empty() || bitmap_burn.is_some() || overlay_input.is_some();
    if video_enabled && video_copy && filtered {
        return Err(invalid_settings(
            "Video effects, scaling and burned subtitles require re-encoding the video stream",
        ));
    }
    if video_enabled && video_copy && retimed {
        return Err(invalid_settings(
            "The time tuner requires re-encoding the video stream",
        ));
    }

    let mut video_section: Vec<String> = Vec::new();
    if video_enabled {
        if bitmap_burn.is_some() || overlay_input.is_some() {
            let mut graph = Vec::new();
            let mut label = "0:v:0".to_string();
            if !chain.is_empty() {
                graph.push(format!("[{label}]{}[vbase]", chain.join(",")));
                label = "vbase".to_string();
            }
            if let Some(stream) = bitmap_burn {
                graph.push(format!("[{label}][0:s:{stream}]overlay[vsub]"));
                label = "vsub".to_string();
            }
            if let Some(input) = overlay_input {
                let overlay = &effects.image_overlay;
                let scale = number_arg(overlay.scale_percent.clamp(1.0, 1000.0));
                let (x, y) = position_expressions(
                    overlay.position,
                    ("W", "H"),
                    ("w", "h"),
                    "0",
                    (overlay.offset_x, overlay.offset_y),
                );
                graph.push(format!(
                    "[{input}:v:0]format=rgba,colorchannelmixer=aa={},scale=iw*{scale}/100:-1[vmark]",
                    opacity_arg(overlay.opacity_percent)
                ));
                graph.push(format!("[{label}][vmark]overlay=x={x}:y={y}[vout]"));
                label = "vout".to_string();
            }
            video_section.extend([
                "-filter_complex".to_string(),
                graph.join(";"),
                "-map".to_string(),
                format!("[{label}]"),
            ]);
        } else {
            video_section.extend(["-map".to_string(), "0:v:0".to_string()]);
            if !chain.is_empty() {
                video_section.extend(["-vf".to_string(), chain.join(",")]);
            }
        }
    }

    let two_pass = video_enabled
        && !video_copy
        && settings.video.rate_control == TranscodeRateControl::TwoPass
        && TWO_PASS_ENCODERS.contains(&settings.video.codec.as_str());
    if video_enabled {
        if video_copy {
            video_section.extend(["-c:v".to_string(), "copy".to_string()]);
        } else {
            video_section.extend(video_codec_args(settings, two_pass));
        }
    } else {
        video_section.push("-vn".to_string());
    }
    video_section.extend(range_output);

    // Audio.
    let mut rest: Vec<String> = Vec::new();
    if audio_enabled {
        let first_only = settings.audio.tracks == TranscodeAudioTracks::First
            || SINGLE_AUDIO_MUXERS.contains(&settings.container.as_str());
        rest.extend([
            "-map".to_string(),
            if first_only { "0:a:0" } else { "0:a" }.to_string(),
        ]);
        let mut audio_filters = Vec::new();
        if retimed {
            audio_filters.push(format!("atempo={}", number_arg(1.0 / stretch)));
        }
        if effects.loudness.enabled {
            audio_filters.push(format!(
                "loudnorm=I={}:LRA={}:TP={}",
                number_arg(effects.loudness.target_lufs.clamp(-70.0, -5.0)),
                number_arg(effects.loudness.range_lu.clamp(1.0, 50.0)),
                number_arg(effects.loudness.true_peak_db.clamp(-9.0, 0.0)),
            ));
        }
        if audio_copy {
            if !audio_filters.is_empty() {
                return Err(invalid_settings(
                    "Audio effects require re-encoding the audio streams",
                ));
            }
            rest.extend(["-c:a".to_string(), "copy".to_string()]);
        } else {
            rest.extend(["-c:a".to_string(), settings.audio.codec.clone()]);
            if let Some(bitrate) = settings.audio.bitrate_kbps.filter(|value| *value > 0) {
                rest.extend(["-b:a".to_string(), format!("{bitrate}k")]);
            }
            if let Some(sample_rate) = settings.audio.sample_rate {
                rest.extend(["-ar".to_string(), sample_rate.to_string()]);
            }
            if let Some(channels) = settings.audio.channels {
                rest.extend(["-ac".to_string(), channels.to_string()]);
            }
            if !audio_filters.is_empty() {
                rest.extend(["-af".to_string(), audio_filters.join(",")]);
            }
        }
    } else {
        rest.push("-an".to_string());
    }

    // Subtitles.
    match &subtitle_plan {
        SubtitlePlan::Mux { streams } => {
            for (input, stream, _) in streams {
                rest.extend(["-map".to_string(), format!("{input}:{stream}")]);
            }
            let first = &streams[0].2;
            if streams.iter().all(|(_, _, codec)| codec == first) {
                rest.extend(["-c:s".to_string(), first.clone()]);
            } else {
                for (output_index, (_, _, codec)) in streams.iter().enumerate() {
                    rest.extend([format!("-c:s:{output_index}"), codec.clone()]);
                }
            }
        }
        _ => rest.push("-sn".to_string()),
    }

    if !settings.comment.trim().is_empty() {
        rest.extend([
            "-metadata".to_string(),
            format!("comment={}", settings.comment.trim()),
        ]);
    }
    if settings.fast_start && FAST_START_MUXERS.contains(&settings.container.as_str()) {
        rest.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }
    rest.extend(split_extra_args(&settings.extra_args));
    rest.extend([
        "-f".to_string(),
        settings.container.clone(),
        output_path.to_string_lossy().into_owned(),
    ]);

    let mut sidecar_paths = Vec::new();
    if let SubtitlePlan::Sidecar { streams } = &subtitle_plan {
        for index in streams {
            let Some(stream) = source
                .subtitles
                .iter()
                .find(|stream| stream.index == *index)
            else {
                continue;
            };
            let path = sidecar_path(output_path, stream, &settings.subtitles.sidecar_extension);
            rest.extend([
                "-map".to_string(),
                format!("0:s:{index}"),
                "-c:s".to_string(),
                settings.subtitles.codec.clone(),
                path.to_string_lossy().into_owned(),
            ]);
            sidecar_paths.push(path);
        }
    }

    let mut passes = Vec::new();
    if two_pass {
        let log = temp_dir.join("pass").to_string_lossy().into_owned();
        let mut first = inputs.clone();
        first.extend(video_section.clone());
        first.extend([
            "-an".to_string(),
            "-sn".to_string(),
            "-pass".to_string(),
            "1".to_string(),
            "-passlogfile".to_string(),
            log.clone(),
            "-f".to_string(),
            "null".to_string(),
            "-".to_string(),
        ]);
        passes.push(first);
        let mut second = inputs;
        second.extend(video_section);
        second.extend([
            "-pass".to_string(),
            "2".to_string(),
            "-passlogfile".to_string(),
            log,
        ]);
        second.extend(rest);
        passes.push(second);
    } else {
        let mut args = inputs;
        args.extend(video_section);
        args.extend(rest);
        passes.push(args);
    }

    Ok(TranscodePlan {
        passes,
        sidecar_paths,
        temp_files,
        duration_us,
    })
}

/// Rows of an FFmpeg `-muxers`, `-encoders` or `-filters` listing as
/// `(flags, name, description)`, skipping the legend.
fn parse_listing(output: &str) -> Vec<(String, String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let flags = fields.next()?;
            let name = fields.next()?;
            if name == "=" || flags.ends_with(':') || flags.starts_with("--") {
                return None;
            }
            let description = fields.collect::<Vec<_>>().join(" ");
            Some((flags.to_string(), name.to_string(), description))
        })
        .collect()
}

pub(crate) fn parse_muxers(output: &str) -> Vec<TranscodeCodecEntry> {
    parse_listing(output)
        .into_iter()
        .filter(|(flags, _, _)| flags.contains('E') && !flags.contains('d'))
        .map(|(_, name, description)| TranscodeCodecEntry { name, description })
        .collect()
}

pub(crate) fn parse_encoders(output: &str, kind: char) -> Vec<TranscodeCodecEntry> {
    parse_listing(output)
        .into_iter()
        .filter(|(flags, _, _)| flags.len() == 6 && flags.starts_with(kind))
        .map(|(_, name, description)| TranscodeCodecEntry { name, description })
        .collect()
}

pub(crate) fn parse_filters(output: &str) -> Vec<String> {
    parse_listing(output)
        .into_iter()
        .filter(|(_, _, description)| description.contains("->"))
        .map(|(_, name, _)| name)
        .collect()
}

pub(crate) fn parse_codec_details(name: &str, output: &str) -> TranscodeCodecDetails {
    let mut details = TranscodeCodecDetails {
        name: name.to_string(),
        ..TranscodeCodecDetails::default()
    };
    let words = |value: &str| -> Vec<String> {
        value
            .split(|ch: char| ch.is_whitespace() || ch == ',')
            .map(|word| word.trim_end_matches('.'))
            .filter(|word| !word.is_empty())
            .map(str::to_string)
            .collect()
    };
    let single = |value: &str| words(value).into_iter().next();
    for line in output.lines() {
        let Some((key, value)) = line.trim().split_once(':') else {
            continue;
        };
        match key.trim() {
            "Common extensions" => details.extensions = words(value),
            "Default video codec" => details.default_video_codec = single(value),
            "Default audio codec" => details.default_audio_codec = single(value),
            "Default subtitle codec" => details.default_subtitle_codec = single(value),
            "Supported pixel formats" => details.pixel_formats = words(value),
            "Supported sample rates" => {
                details.sample_rates = words(value)
                    .iter()
                    .filter_map(|word| word.parse().ok())
                    .collect()
            }
            "Supported channel layouts" => details.channel_layouts = words(value),
            _ => {}
        }
    }
    details
}

fn optional_i64(value: Option<&str>) -> Option<i64> {
    value.and_then(|value| value.trim().parse().ok())
}

pub(crate) fn transcode_source_info(probe: &ProbeOutput) -> TranscodeSourceInfo {
    let mut info = TranscodeSourceInfo {
        duration_us: probe
            .format
            .as_ref()
            .and_then(|format| format.duration.as_deref())
            .map(parse_decimal_seconds_to_us)
            .unwrap_or(0)
            .max(0),
        ..TranscodeSourceInfo::default()
    };
    for stream in &probe.streams {
        // Cover art is a still image, not a video track to transcode.
        if stream
            .disposition
            .get("attached_pic")
            .is_some_and(|value| *value != 0)
        {
            continue;
        }
        let codec = stream.codec_name.clone().unwrap_or_default();
        let target = match stream.codec_type.as_deref() {
            Some("video") => &mut info.video,
            Some("audio") => &mut info.audio,
            Some("subtitle") => &mut info.subtitles,
            _ => continue,
        };
        target.push(TranscodeSourceStream {
            index: target.len(),
            bitmap: BITMAP_SUBTITLE_CODECS.contains(&codec.as_str()),
            codec,
            language: stream.tags.get("language").cloned(),
            title: stream.tags.get("title").cloned(),
            width: stream.width,
            height: stream.height,
            frame_rate: stream
                .avg_frame_rate
                .clone()
                .filter(|rate| !rate.starts_with("0/"))
                .or_else(|| stream.r_frame_rate.clone()),
            sample_rate: optional_i64(stream.sample_rate.as_deref()),
            channels: stream.channels,
            color_transfer: stream.color_transfer.clone(),
        });
    }
    info
}

/// A font able to draw CJK file names, for builds without fontconfig.
fn overlay_font_file() -> Option<String> {
    #[cfg(target_os = "macos")]
    let candidates: Vec<PathBuf> = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    #[cfg(windows)]
    let candidates: Vec<PathBuf> = {
        let fonts = PathBuf::from(env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
            .join("Fonts");
        ["msyh.ttc", "simhei.ttf", "arial.ttf"]
            .iter()
            .map(|name| fonts.join(name))
            .collect()
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let candidates: Vec<PathBuf> = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

/// The first free `stem.ext`, `stem_1.ext`... in the directory.
pub(crate) fn available_output_path(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let stem = safe_component(stem);
    let mut candidate = directory.join(format!("{stem}.{extension}"));
    let mut suffix = 1_u32;
    while candidate.exists() {
        candidate = directory.join(format!("{stem}_{suffix}.{extension}"));
        suffix += 1;
    }
    candidate
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

async fn listing(
    program: &str,
    flag: &str,
    state: &AppState,
    task_id: &str,
    cancel: Arc<AtomicBool>,
) -> AppResult<String> {
    run_output_with_timeout(
        program,
        &["-hide_banner".to_string(), flag.to_string()],
        state,
        task_id,
        cancel,
        TRANSCODE_LISTING_TIMEOUT,
    )
    .await
}

#[tauri::command]
pub(crate) async fn transcode_capabilities(
    state: tauri::State<'_, AppState>,
) -> CommandResult<TranscodeCapabilities> {
    let preferences = preferences_clone(&state)?;
    let program = ffmpeg_program(&preferences);
    let task_id = format!("transcode-capabilities:{}", Uuid::new_v4());
    let task = register_task(&task_id, state.inner())?;
    let state = state.inner();
    let muxers = listing(&program, "-muxers", state, &task_id, task.cancel_token()).await?;
    let encoders = listing(&program, "-encoders", state, &task_id, task.cancel_token()).await?;
    let filters = listing(&program, "-filters", state, &task_id, task.cancel_token()).await?;
    let version = listing(&program, "-version", state, &task_id, task.cancel_token()).await?;
    Ok(TranscodeCapabilities {
        version: version
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(2))
            .unwrap_or_default()
            .to_string(),
        muxers: parse_muxers(&muxers),
        video_encoders: parse_encoders(&encoders, 'V'),
        audio_encoders: parse_encoders(&encoders, 'A'),
        subtitle_encoders: parse_encoders(&encoders, 'S'),
        filters: parse_filters(&filters),
    })
}

#[tauri::command]
pub(crate) async fn transcode_codec_details(
    kind: String,
    name: String,
    state: tauri::State<'_, AppState>,
) -> CommandResult<TranscodeCodecDetails> {
    if kind != "encoder" && kind != "muxer" {
        return Err(invalid_settings("Unknown transcode detail kind"));
    }
    validate_token(&name, "name")?;
    let preferences = preferences_clone(&state)?;
    let program = ffmpeg_program(&preferences);
    let task_id = format!("transcode-details:{}", Uuid::new_v4());
    let task = register_task(&task_id, state.inner())?;
    let output = run_output_with_timeout(
        &program,
        &[
            "-hide_banner".to_string(),
            "-h".to_string(),
            format!("{kind}={name}"),
        ],
        state.inner(),
        &task_id,
        task.cancel_token(),
        TRANSCODE_LISTING_TIMEOUT,
    )
    .await?;
    Ok(parse_codec_details(&name, &output))
}

#[tauri::command]
pub(crate) async fn probe_transcode_source(
    path: String,
    state: tauri::State<'_, AppState>,
) -> CommandResult<TranscodeSourceInfo> {
    let preferences = preferences_clone(&state)?;
    let task_id = format!("transcode-probe:{}", Uuid::new_v4());
    let task = register_task(&task_id, state.inner())?;
    let probe = probe_media_with_timeout(
        Path::new(&path),
        &preferences,
        state.inner(),
        &task_id,
        task.cancel_token(),
        TRANSCODE_PROBE_TIMEOUT,
    )
    .await?;
    Ok(transcode_source_info(&probe))
}

#[tauri::command]
pub(crate) async fn transcode_media(
    job: TranscodeJob,
    task_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<TranscodeResult> {
    let task = register_task(&task_id, state.inner())?;
    let preferences = preferences_clone(&state)?;
    validate_transcode_settings(&job.settings)?;
    let input_path = PathBuf::from(&job.input_path);
    if !input_path.is_file() {
        return Err(app_error(
            ErrorCode::FileNotFound,
            format!("Transcode source does not exist: {}", input_path.display()),
        ));
    }
    if job.output_dir.trim().is_empty() || job.output_name.trim().is_empty() {
        return Err(app_error(
            ErrorCode::TranscodeOutputRequired,
            "Transcode output directory or file name is empty",
        ));
    }
    emit_ffmpeg_progress(&app, &task_id, 0.0);

    let probe = probe_media_with_timeout(
        &input_path,
        &preferences,
        state.inner(),
        &task_id,
        task.cancel_token(),
        TRANSCODE_PROBE_TIMEOUT,
    )
    .await?;
    let source = transcode_source_info(&probe);
    task.check_cancelled()?;

    let output_dir = PathBuf::from(job.output_dir.trim());
    let temp_dir = configured_cache_root(&preferences)
        .join("Transcode")
        .join(Uuid::new_v4().to_string());
    let output_path = {
        let output_dir = output_dir.clone();
        let temp_dir = temp_dir.clone();
        let input_path = input_path.clone();
        let stem = job.output_name.trim().to_string();
        let extension = job.settings.extension.clone();
        let overwrite = job.overwrite;
        spawn_blocking_cancellable(task.cancel_token(), "prepare transcode output", move |_| {
            for directory in [&output_dir, &temp_dir] {
                fs::create_dir_all(directory).map_err(|error| {
                    app_error(
                        ErrorCode::TranscodeWriteFailed,
                        format!(
                            "Failed to create transcode directory {}: {error}",
                            directory.display()
                        ),
                    )
                })?;
            }
            let output_path = if overwrite {
                output_dir.join(format!("{}.{extension}", safe_component(&stem)))
            } else {
                available_output_path(&output_dir, &stem, &extension)
            };
            if same_file(&output_path, &input_path) {
                return Err(invalid_settings(
                    "Transcode output would overwrite its own source file",
                ));
            }
            Ok(output_path)
        })
        .await?
    };

    let font_file = overlay_font_file();
    let plan =
        match build_transcode_plan(&job, &source, &output_path, &temp_dir, font_file.as_deref()) {
            Ok(plan) => plan,
            Err(error) => {
                remove_cleanup_paths_async(vec![temp_dir]).await;
                return Err(error);
            }
        };
    for (path, body) in &plan.temp_files {
        if let Err(error) = fs::write(path, body) {
            remove_cleanup_paths_async(vec![temp_dir]).await;
            return Err(app_error(
                ErrorCode::TranscodeWriteFailed,
                format!(
                    "Failed to write transcode overlay text {}: {error}",
                    path.display()
                ),
            ));
        }
    }

    let mut cleanup_paths = vec![output_path.clone()];
    cleanup_paths.extend(plan.sidecar_paths.iter().cloned());
    let program = ffmpeg_program(&preferences);
    let pass_count = plan.passes.len().max(1) as f64;
    let mut outcome = Ok(());
    for (index, args) in plan.passes.iter().enumerate() {
        outcome = run_status_with_ffmpeg_progress(
            &program,
            args,
            FfmpegProgressContext {
                app: &app,
                state: state.inner(),
                task_id: &task_id,
                watchdog_label: format!("transcode -> {}", output_path.display()),
                cancel: task.cancel_token(),
                base_progress: index as f64 / pass_count,
                progress_span: 1.0 / pass_count,
                duration_us: plan.duration_us,
                cleanup_paths: cleanup_paths.clone(),
                progress_callback: None,
            },
        )
        .await;
        if outcome.is_err() {
            break;
        }
    }
    remove_cleanup_paths_async(vec![temp_dir]).await;
    outcome?;
    task.check_cancelled()?;

    let written = fs::metadata(&output_path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false);
    if !written {
        remove_cleanup_paths_async(cleanup_paths).await;
        return Err(app_error(
            ErrorCode::TranscodeWriteFailed,
            format!(
                "Transcode finished without writing {}",
                output_path.display()
            ),
        ));
    }
    unregister_task_cleanup_paths(&task_id, &cleanup_paths, state.inner())?;
    emit_ffmpeg_progress(&app, &task_id, 1.0);
    Ok(TranscodeResult {
        output_path: output_path.to_string_lossy().into_owned(),
        sidecar_paths: plan
            .sidecar_paths
            .iter()
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    })
}

fn transcode_config_path() -> PathBuf {
    preferences_file().with_file_name(TRANSCODE_CONFIG_FILE_NAME)
}

/// The queue, presets and watch folders are owned by the frontend; the backend
/// only persists them as one JSON document.
#[tauri::command]
pub(crate) fn load_transcode_config() -> CommandResult<Option<serde_json::Value>> {
    let path = transcode_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let body = fs::read_to_string(&path).map_err(|error| {
        app_error(
            ErrorCode::TranscodeConfigReadFailed,
            format!(
                "Failed to read transcode config {}: {error}",
                path.display()
            ),
        )
    })?;
    // A damaged config must not block the workspace; start from defaults.
    Ok(serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .filter(serde_json::Value::is_object))
}

#[tauri::command]
pub(crate) fn save_transcode_config(config: serde_json::Value) -> CommandResult<()> {
    if !config.is_object() {
        return Err(invalid_settings("Transcode config must be a JSON object"));
    }
    let path = transcode_config_path();
    let write_failed = |action: &str, error: std::io::Error| {
        app_error(
            ErrorCode::TranscodeConfigWriteFailed,
            format!(
                "Failed to {action} transcode config {}: {error}",
                path.display()
            ),
        )
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| write_failed("create directory for", error))?;
    }
    let staged = path.with_extension("json.tmp");
    fs::write(&staged, config.to_string()).map_err(|error| write_failed("stage", error))?;
    fs::rename(&staged, &path).map_err(|error| write_failed("replace", error))
}

const TRANSCODE_PRESET_EXTENSION: &str = "lcpreset";
const TRANSCODE_PRESET_MAX_BYTES: u64 = 1024 * 1024;

fn preset_file_path(path: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(path);
    let is_preset = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(TRANSCODE_PRESET_EXTENSION));
    if is_preset {
        Ok(path)
    } else {
        Err(invalid_settings(
            "Transcode preset files use the .lcpreset extension",
        ))
    }
}

#[tauri::command]
pub(crate) fn read_transcode_preset(path: String) -> CommandResult<String> {
    let path = preset_file_path(&path)?;
    let read_failed = |error: std::io::Error| {
        app_error(
            ErrorCode::TranscodeConfigReadFailed,
            format!(
                "Failed to read transcode preset {}: {error}",
                path.display()
            ),
        )
    };
    let size = fs::metadata(&path).map_err(read_failed)?.len();
    if size > TRANSCODE_PRESET_MAX_BYTES {
        return Err(invalid_settings("Transcode preset file is too large"));
    }
    fs::read_to_string(&path).map_err(read_failed)
}

#[tauri::command]
pub(crate) fn write_transcode_preset(path: String, body: String) -> CommandResult<()> {
    let path = preset_file_path(&path)?;
    fs::write(&path, body).map_err(|error| {
        app_error(
            ErrorCode::TranscodeConfigWriteFailed,
            format!(
                "Failed to write transcode preset {}: {error}",
                path.display()
            ),
        )
    })
}

#[cfg(test)]
// Tests start from the defaults and change only the setting under test.
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    fn stream(index: usize, codec: &str, bitmap: bool) -> TranscodeSourceStream {
        TranscodeSourceStream {
            index,
            codec: codec.to_string(),
            language: None,
            title: None,
            width: Some(1920),
            height: Some(1080),
            frame_rate: Some("24000/1001".to_string()),
            sample_rate: Some(48_000),
            channels: Some(2),
            bitmap,
            color_transfer: None,
        }
    }

    fn source() -> TranscodeSourceInfo {
        TranscodeSourceInfo {
            duration_us: 60_000_000,
            video: vec![stream(0, "h264", false)],
            audio: vec![stream(0, "aac", false), stream(1, "ac3", false)],
            subtitles: vec![
                stream(0, "ass", false),
                stream(1, "hdmv_pgs_subtitle", true),
                TranscodeSourceStream {
                    language: Some("jpn".to_string()),
                    ..stream(2, "subrip", false)
                },
            ],
        }
    }

    fn job(settings: TranscodeSettings) -> TranscodeJob {
        TranscodeJob {
            input_path: "/media/[source] clip.mkv".to_string(),
            output_dir: "/out".to_string(),
            output_name: "clip".to_string(),
            overwrite: false,
            settings,
        }
    }

    fn plan(settings: TranscodeSettings) -> TranscodePlan {
        build_transcode_plan(
            &job(settings),
            &source(),
            Path::new("/out/clip.mp4"),
            Path::new("/tmp/transcode"),
            Some("/fonts/sans.ttf"),
        )
        .expect("plan")
    }

    fn has_pair(args: &[String], key: &str, value: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == key && pair[1] == value)
    }

    fn value_of<'a>(args: &'a [String], key: &str) -> &'a str {
        args.windows(2)
            .find(|pair| pair[0] == key)
            .map(|pair| pair[1].as_str())
            .unwrap_or_default()
    }

    #[test]
    fn default_settings_encode_h264_aac_and_copy_what_mp4_can_hold() {
        let plan = plan(TranscodeSettings::default());
        assert_eq!(plan.passes.len(), 1);
        let args = &plan.passes[0];
        assert!(has_pair(args, "-c:v", "libx264"));
        assert!(has_pair(args, "-crf", "20"));
        assert!(has_pair(args, "-pix_fmt", "yuv420p"));
        assert!(has_pair(args, "-map", "0:a"));
        assert!(has_pair(args, "-b:a", "320k"));
        // MP4 cannot hold ASS or SubRip: copied text streams become timed
        // text, and the PGS stream, which cannot be converted, is left out.
        assert!(has_pair(args, "-map", "0:s:0") && has_pair(args, "-map", "0:s:2"));
        assert!(!has_pair(args, "-map", "0:s:1"));
        assert!(has_pair(args, "-c:s", "mov_text"));
        assert!(has_pair(args, "-movflags", "+faststart"));
        assert!(has_pair(args, "-f", "mp4"));
        assert_eq!(args.last().map(String::as_str), Some("/out/clip.mp4"));
        assert_eq!(plan.duration_us, 60_000_000);
    }

    #[test]
    fn settings_reject_values_that_could_become_options() {
        let mut settings = TranscodeSettings::default();
        settings.video.codec = "-i".to_string();
        assert!(validate_transcode_settings(&settings).is_err());
        let mut settings = TranscodeSettings::default();
        settings.video.pixel_format = Some("yuv420p -y".to_string());
        assert!(validate_transcode_settings(&settings).is_err());
        let mut settings = TranscodeSettings::default();
        settings.video.frame_rate = Some("24000/1001".to_string());
        assert!(validate_transcode_settings(&settings).is_ok());
        settings.video.frame_rate = Some("fast".to_string());
        assert!(validate_transcode_settings(&settings).is_err());
    }

    #[test]
    fn text_conversion_maps_only_text_streams_and_single_file_muxers_take_one() {
        let mut settings = TranscodeSettings::default();
        settings.container = "matroska".to_string();
        settings.subtitles.mode = TranscodeSubtitleMode::Convert;
        settings.subtitles.codec = "ass".to_string();
        let args = plan(settings.clone()).passes.remove(0);
        assert!(has_pair(&args, "-map", "0:s:0"));
        assert!(has_pair(&args, "-map", "0:s:2"));
        assert!(!has_pair(&args, "-map", "0:s:1"));
        assert!(has_pair(&args, "-c:s", "ass"));

        settings.container = "ass".to_string();
        settings.export_video = false;
        settings.export_audio = false;
        let args = plan(settings).passes.remove(0);
        assert!(args.contains(&"-vn".to_string()));
        assert!(args.contains(&"-an".to_string()));
        assert!(has_pair(&args, "-map", "0:s:0"));
        assert!(!has_pair(&args, "-map", "0:s:2"));
    }

    #[test]
    fn copied_subtitles_keep_compatible_streams_and_convert_the_rest() {
        let mut settings = TranscodeSettings::default();
        settings.container = "matroska".to_string();
        let mut mixed = source();
        mixed.subtitles[2].codec = "mov_text".to_string();
        let args = build_transcode_plan(
            &job(settings),
            &mixed,
            Path::new("/out/clip.mkv"),
            Path::new("/tmp/transcode"),
            None,
        )
        .expect("plan")
        .passes
        .remove(0);
        assert!(has_pair(&args, "-map", "0:s:1"), "Matroska keeps PGS");
        assert!(has_pair(&args, "-c:s:0", "copy"));
        assert!(has_pair(&args, "-c:s:1", "copy"));
        assert!(has_pair(&args, "-c:s:2", "subrip"));
        assert_eq!(
            copied_subtitle_codec("webm", Some("webvtt"), false).as_deref(),
            Some("copy")
        );
        assert_eq!(
            copied_subtitle_codec("webm", Some("ass"), false).as_deref(),
            Some("webvtt")
        );
        assert_eq!(
            copied_subtitle_codec("mov", Some("dvd_subtitle"), true),
            None
        );
        assert_eq!(
            copied_subtitle_codec("avi", Some("ass"), false).as_deref(),
            Some("copy")
        );
    }

    #[test]
    fn burned_text_subtitles_escape_the_source_path_and_seek_after_decoding() {
        let mut settings = TranscodeSettings::default();
        settings.subtitles.mode = TranscodeSubtitleMode::Burn;
        settings.subtitles.stream = Some(2);
        settings.range_start_us = Some(5_000_000);
        settings.range_end_us = Some(15_000_000);
        let plan = plan(settings);
        let args = &plan.passes[0];
        assert_eq!(
            value_of(args, "-vf"),
            "subtitles=filename='/media/[source] clip.mkv':si=2"
        );
        let input = args.iter().position(|arg| arg == "-i").expect("input");
        let seek = args.iter().position(|arg| arg == "-ss").expect("seek");
        assert!(seek > input);
        assert!(has_pair(args, "-t", "10.000000"));
        assert!(args.contains(&"-sn".to_string()));
        assert_eq!(plan.duration_us, 10_000_000);
    }

    #[test]
    fn bitmap_subtitles_and_image_overlay_use_one_filter_graph() {
        let mut settings = TranscodeSettings::default();
        settings.subtitles.mode = TranscodeSubtitleMode::Burn;
        settings.subtitles.stream = Some(1);
        settings.video.height = Some(721);
        settings.effects.image_overlay.enabled = true;
        settings.effects.image_overlay.path = "/logos/mark.png".to_string();
        settings.effects.image_overlay.position = TranscodeOverlayPosition::BottomRight;
        settings.effects.image_overlay.opacity_percent = 40.0;
        let args = plan(settings).passes.remove(0);
        assert!(has_pair(&args, "-i", "/logos/mark.png"));
        assert_eq!(
            value_of(&args, "-filter_complex"),
            "[0:v:0]scale=-2:720[vbase];[vbase][0:s:1]overlay[vsub];[1:v:0]format=rgba,colorchannelmixer=aa=0.4,scale=iw*100/100:-1[vmark];[vsub][vmark]overlay=x=W-w-0+(0):y=H-h-0+(0)[vout]"
        );
        assert!(has_pair(&args, "-map", "[vout]"));
        assert!(!has_pair(&args, "-map", "0:v:0"));
    }

    #[test]
    fn range_without_burned_subtitles_seeks_the_input() {
        let mut settings = TranscodeSettings::default();
        settings.range_start_us = Some(2_500_000);
        settings.range_end_us = Some(90_000_000);
        let plan = plan(settings);
        let args = &plan.passes[0];
        let input = args.iter().position(|arg| arg == "-i").expect("input");
        let seek = args.iter().position(|arg| arg == "-ss").expect("seek");
        assert!(seek < input);
        assert!(has_pair(args, "-ss", "2.500000"));
        // The end is clamped to the source duration.
        assert!(has_pair(args, "-t", "57.500000"));
        assert_eq!(plan.duration_us, 57_500_000);
    }

    #[test]
    fn two_pass_runs_an_analysis_pass_only_for_capable_encoders() {
        let mut settings = TranscodeSettings::default();
        settings.video.rate_control = TranscodeRateControl::TwoPass;
        settings.video.bitrate_kbps = 8_000;
        settings.video.max_bitrate_kbps = 12_000;
        let two = plan(settings.clone());
        assert_eq!(two.passes.len(), 2);
        assert!(has_pair(&two.passes[0], "-pass", "1"));
        assert!(has_pair(&two.passes[0], "-f", "null"));
        assert!(!has_pair(&two.passes[0], "-f", "mp4"));
        assert!(has_pair(&two.passes[1], "-pass", "2"));
        assert!(has_pair(&two.passes[1], "-b:v", "8000k"));
        assert!(has_pair(&two.passes[1], "-maxrate", "12000k"));
        assert!(has_pair(&two.passes[1], "-bufsize", "24000k"));

        settings.video.codec = "hevc_videotoolbox".to_string();
        let single = plan(settings);
        assert_eq!(single.passes.len(), 1);
        assert!(has_pair(&single.passes[0], "-b:v", "8000k"));
        assert!(has_pair(&single.passes[0], "-tag:v", "hvc1"));
    }

    #[test]
    fn quality_arguments_follow_the_encoder_family() {
        let quality = |codec: &str| {
            let mut settings = TranscodeSettings::default();
            settings.video.codec = codec.to_string();
            settings.video.quality = 28.0;
            settings.video.speed_preset = Some("4".to_string());
            plan(settings).passes.remove(0)
        };
        let vp9 = quality("libvpx-vp9");
        assert!(has_pair(&vp9, "-crf", "28") && has_pair(&vp9, "-b:v", "0"));
        assert!(has_pair(&vp9, "-cpu-used", "4") && has_pair(&vp9, "-row-mt", "1"));
        assert!(has_pair(&quality("libsvtav1"), "-preset", "4"));
        assert!(has_pair(&quality("h264_nvenc"), "-cq", "28"));
        assert!(has_pair(&quality("h264_qsv"), "-global_quality", "28"));
        assert!(has_pair(&quality("h264_amf"), "-qp_i", "28"));
        assert!(has_pair(&quality("h264_videotoolbox"), "-q:v", "28"));
        assert!(has_pair(&quality("mpeg4"), "-q:v", "28"));

        let mut prores = TranscodeSettings::default();
        prores.container = "mov".to_string();
        prores.video.codec = "prores_ks".to_string();
        prores.video.profile = Some("3".to_string());
        prores.video.rate_control = TranscodeRateControl::Auto;
        let args = plan(prores).passes.remove(0);
        assert!(has_pair(&args, "-profile:v", "3"));
        assert!(!args.contains(&"-q:v".to_string()) && !args.contains(&"-b:v".to_string()));
    }

    #[test]
    fn stream_copy_refuses_filters_and_single_audio_muxers_take_the_first_track() {
        let mut settings = TranscodeSettings::default();
        settings.video.codec = "copy".to_string();
        settings.audio.codec = "copy".to_string();
        let args = plan(settings.clone()).passes.remove(0);
        assert!(has_pair(&args, "-c:v", "copy") && has_pair(&args, "-c:a", "copy"));
        assert!(!args.contains(&"-crf".to_string()));

        settings.video.width = Some(1280);
        assert!(build_transcode_plan(
            &job(settings),
            &source(),
            Path::new("/out/clip.mp4"),
            Path::new("/tmp/transcode"),
            None,
        )
        .is_err());

        let mut audio = TranscodeSettings::default();
        audio.container = "mp3".to_string();
        audio.export_video = false;
        audio.export_subtitles = false;
        audio.audio.codec = "libmp3lame".to_string();
        let args = plan(audio).passes.remove(0);
        assert!(has_pair(&args, "-map", "0:a:0"));
        assert!(args.contains(&"-vn".to_string()) && args.contains(&"-sn".to_string()));
    }

    #[test]
    fn effects_build_video_and_audio_filter_chains() {
        let mut settings = TranscodeSettings::default();
        settings.video.deinterlace = true;
        settings.video.width = Some(1280);
        settings.video.height = Some(720);
        settings.effects.lut.enabled = true;
        settings.effects.lut.path = "C:\\Looks\\it's.cube".to_string();
        settings.effects.video_limiter.enabled = true;
        settings.effects.time_tuner.enabled = true;
        settings.effects.time_tuner.duration_change_percent = -4.0;
        settings.effects.text_overlay.enabled = true;
        settings.effects.text_overlay.prefix = "REV ".to_string();
        settings.effects.timecode_overlay.enabled = true;
        settings.effects.loudness.enabled = true;
        let plan = plan(settings);
        let args = &plan.passes[0];
        let filters = value_of(args, "-vf");
        assert!(filters.starts_with("bwdif=mode=send_frame:parity=auto:deint=all,lut3d=file='C\\:/Looks/it\\'\\''s.cube',scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,limiter=max=242:planes=1,setpts=PTS*0.96,drawtext=textfile='/tmp/transcode/text-overlay.txt':expansion=none:fontfile='/fonts/sans.ttf'"));
        assert!(filters.contains("drawtext=timecode='00\\:00\\:00\\:00':rate=24000/1001"));
        assert_eq!(
            value_of(args, "-af"),
            "atempo=1.042,loudnorm=I=-24:LRA=7:TP=-2"
        );
        assert_eq!(plan.temp_files.len(), 1);
        assert_eq!(plan.temp_files[0].1, "REV [source] clip.mkv");
        assert_eq!(plan.duration_us, 57_600_000);
    }

    #[test]
    fn tone_mapping_follows_the_source_transfer() {
        let mut settings = TranscodeSettings::default();
        settings.effects.tone_mapping.enabled = true;
        let tone_mapped = |transfer: Option<&str>| {
            let mut hdr = source();
            hdr.video[0].color_transfer = transfer.map(str::to_string);
            let args = build_transcode_plan(
                &job(settings.clone()),
                &hdr,
                Path::new("/out/clip.mp4"),
                Path::new("/tmp/transcode"),
                None,
            )
            .expect("plan")
            .passes
            .remove(0);
            value_of(&args, "-vf").to_string()
        };
        assert!(tone_mapped(Some("arib-std-b67"))
            .starts_with("setparams=color_primaries=bt2020:color_trc=arib-std-b67:"));
        assert!(tone_mapped(None).starts_with(
            "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc"
        ));
        assert_eq!(
            tone_mapped(Some("bt709")),
            "",
            "an SDR source is not tone mapped"
        );
    }

    #[test]
    fn sidecar_subtitles_become_additional_outputs_named_by_stream() {
        let mut settings = TranscodeSettings::default();
        settings.subtitles.mode = TranscodeSubtitleMode::Sidecar;
        settings.subtitles.codec = "subrip".to_string();
        settings.subtitles.sidecar_extension = "srt".to_string();
        let plan = plan(settings);
        assert_eq!(
            plan.sidecar_paths,
            [
                PathBuf::from("/out/clip.1.srt"),
                PathBuf::from("/out/clip.3.jpn.srt")
            ]
        );
        let args = &plan.passes[0];
        let main = args
            .iter()
            .position(|arg| arg == "/out/clip.mp4")
            .expect("main output");
        assert_eq!(
            &args[main + 1..main + 5],
            ["-map", "0:s:0", "-c:s", "subrip"]
        );
        assert!(args[..main].contains(&"-sn".to_string()));
    }

    #[test]
    fn sources_without_exported_streams_are_rejected() {
        let mut settings = TranscodeSettings::default();
        settings.export_audio = false;
        settings.export_subtitles = false;
        let audio_only = TranscodeSourceInfo {
            video: Vec::new(),
            ..source()
        };
        assert!(build_transcode_plan(
            &job(settings),
            &audio_only,
            Path::new("/out/clip.mp4"),
            Path::new("/tmp/transcode"),
            None,
        )
        .is_err());
    }

    #[test]
    fn extra_arguments_split_like_a_shell() {
        assert_eq!(
            split_extra_args(
                "  -tune film -x264-params \"keyint=48:min keyint=24\" -metadata title='' "
            ),
            [
                "-tune",
                "film",
                "-x264-params",
                "keyint=48:min keyint=24",
                "-metadata",
                "title="
            ]
        );
        let mut settings = TranscodeSettings::default();
        settings.extra_args = "-tune film".to_string();
        let args = plan(settings).passes.remove(0);
        let tune = args.iter().position(|arg| arg == "-tune").expect("tune");
        let format = args.iter().position(|arg| arg == "-f").expect("format");
        assert!(tune < format);
    }

    #[test]
    fn listings_skip_the_legend_and_split_encoders_by_type() {
        let muxers = "Formats:\n D.. = Demuxing supported\n .E. = Muxing supported\n ..d = Is a device\n ---\n  E  matroska        Matroska\n  E  mp4             MP4 (MPEG-4 Part 14)\n  Ed sdl,sdl2        SDL2 output device\n";
        assert_eq!(
            parse_muxers(muxers)
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["matroska", "mp4"]
        );
        let encoders = "Encoders:\n V..... = Video\n A..... = Audio\n ------\n V....D libx264              libx264 H.264 / AVC (codec h264)\n A....D aac                  AAC (Advanced Audio Coding)\n S..... ass                  ASS (Advanced SubStation Alpha) subtitle\n";
        assert_eq!(parse_encoders(encoders, 'V')[0].name, "libx264");
        assert_eq!(
            parse_encoders(encoders, 'V')[0].description,
            "libx264 H.264 / AVC (codec h264)"
        );
        assert_eq!(parse_encoders(encoders, 'A')[0].name, "aac");
        assert_eq!(parse_encoders(encoders, 'S')[0].name, "ass");
        let filters = "Filters:\n  T.. = Timeline support\n  | = Source or sink filter\n  ------\n .. atempo            A->A       Adjust audio tempo.\n TS lut3d             V->V       Adjust colors using a 3D LUT.\n";
        assert_eq!(parse_filters(filters), ["atempo", "lut3d"]);
    }

    #[test]
    fn codec_details_read_extensions_and_supported_formats() {
        let muxer = parse_codec_details(
            "matroska",
            "Muxer matroska [Matroska]:\n    Common extensions: mkv.\n    Mime type: video/x-matroska.\n    Default video codec: h264.\n    Default audio codec: ac3.\n    Default subtitle codec: ass.\n",
        );
        assert_eq!(muxer.extensions, ["mkv"]);
        assert_eq!(muxer.default_subtitle_codec.as_deref(), Some("ass"));
        let encoder = parse_codec_details(
            "aac",
            "Encoder aac [AAC]:\n    Supported sample rates: 96000 48000 44100\n    Supported pixel formats: yuv420p nv12\n    Supported channel layouts: mono stereo\n",
        );
        assert_eq!(encoder.sample_rates, [96_000, 48_000, 44_100]);
        assert_eq!(encoder.pixel_formats, ["yuv420p", "nv12"]);
        assert_eq!(encoder.channel_layouts, ["mono", "stereo"]);
    }

    #[test]
    fn source_info_indexes_streams_by_type_and_skips_cover_art() {
        let probe: ProbeOutput = serde_json::from_str(
            r#"{"format":{"duration":"12.5"},"streams":[
                {"index":0,"codec_type":"video","codec_name":"hevc","avg_frame_rate":"0/0","r_frame_rate":"25/1","width":3840,"height":2160},
                {"index":1,"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},
                {"index":2,"codec_type":"audio","codec_name":"flac","sample_rate":"96000","channels":6},
                {"index":3,"codec_type":"subtitle","codec_name":"hdmv_pgs_subtitle","tags":{"language":"chi"}},
                {"index":4,"codec_type":"subtitle","codec_name":"ass"}]}"#,
        )
        .expect("probe");
        let info = transcode_source_info(&probe);
        assert_eq!(info.duration_us, 12_500_000);
        assert_eq!(info.video.len(), 1);
        assert_eq!(info.video[0].frame_rate.as_deref(), Some("25/1"));
        assert_eq!(info.audio[0].sample_rate, Some(96_000));
        assert!(info.subtitles[0].bitmap);
        assert_eq!(info.subtitles[0].language.as_deref(), Some("chi"));
        assert_eq!(info.subtitles[1].index, 1);
        assert!(!info.subtitles[1].bitmap);
    }
}
