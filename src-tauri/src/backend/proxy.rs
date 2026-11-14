use super::*;

pub(crate) fn proxy_output_path(
    project: &MediaDocument,
    preferences: &Preferences,
    options: &ProxyOptions,
) -> AppResult<PathBuf> {
    let output_dir = match options.location {
        ProxyLocation::SourceProxyFolder => {
            let source_path = PathBuf::from(&project.asset.path);
            source_path
                .parent()
                .map(|parent| parent.join("Proxy"))
                .unwrap_or_else(|| PathBuf::from(&project.cache_dir).join("Proxy"))
        }
        ProxyLocation::Custom => {
            let trimmed = options.custom_location.trim();
            if trimmed.is_empty() {
                return Err(app_error(
                    ErrorCode::ProxyOutputRequired,
                    "Proxy output directory is empty",
                ));
            }
            PathBuf::from(trimmed)
        }
        ProxyLocation::PreferencesCache => {
            configured_cache_root(preferences).join(&project.asset.fingerprint)
        }
    };

    let source_stem = Path::new(&project.asset.file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_string());
    // A remux gets its own name: an existing lossy `_Proxy` file must never be
    // reused as the lossless one, because generation skips existing outputs.
    let suffix = match options.preset {
        ProxyPreset::Remux => "Remux",
        _ => "Proxy",
    };
    let stem = safe_component(&format!("{source_stem}_{suffix}"));
    Ok(output_dir.join(format!("{stem}.{}", proxy_extension(options.preset))))
}

pub(crate) fn proxy_extension(preset: ProxyPreset) -> &'static str {
    match preset {
        ProxyPreset::H264Mp4 | ProxyPreset::H264Mp4AllIntra => "mp4",
        ProxyPreset::Remux | ProxyPreset::H264Quicktime => "mov",
        ProxyPreset::Vp8Webm | ProxyPreset::Vp9Webm => "webm",
    }
}

pub(crate) fn proxy_video_filter(options: &ProxyOptions) -> AppResult<Option<String>> {
    if options.preset == ProxyPreset::Remux {
        // Stream copy cannot be filtered; the remux keeps the source frames.
        return Ok(None);
    }
    let filter = match options.frame_size {
        ProxyFrameSize::Full => Some("scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string()),
        ProxyFrameSize::Half => Some("scale=trunc(iw/4)*2:-2".to_string()),
        ProxyFrameSize::Quarter => Some("scale=trunc(iw/8)*2:-2".to_string()),
        ProxyFrameSize::Custom => {
            let width = proxy_custom_width(options);
            let height = proxy_custom_height(options);
            if width < 2 || height < 2 {
                return Err(app_error(
                    ErrorCode::ProxyDimensionsInvalid,
                    "Custom proxy dimensions must be at least 2 pixels",
                ));
            }
            Some(format!(
                "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
            ))
        }
    };

    match options.watermark {
        ProxyWatermark::None => Ok(filter),
    }
}

pub(crate) fn proxy_custom_width(options: &ProxyOptions) -> i64 {
    even_proxy_dimension(options.custom_width)
}

pub(crate) fn proxy_custom_height(options: &ProxyOptions) -> i64 {
    even_proxy_dimension(options.custom_height)
}

pub(crate) fn even_proxy_dimension(value: i64) -> i64 {
    let value = value.max(2);
    if value % 2 == 0 {
        value
    } else {
        (value - 1).max(2)
    }
}

pub(crate) fn append_proxy_preset_args(
    args: &mut Vec<String>,
    preset: ProxyPreset,
    watermark: ProxyWatermark,
) {
    match watermark {
        ProxyWatermark::None => {}
    }

    match preset {
        // Codec arguments depend on the source streams; see `remux_codec_args`.
        ProxyPreset::Remux => {}
        ProxyPreset::H264Mp4 => push_args(
            args,
            &[
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-tune",
                "fastdecode",
                "-crf",
                "23",
                "-g",
                "15",
                "-keyint_min",
                "15",
                "-sc_threshold",
                "0",
                "-bf",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
            ],
        ),
        ProxyPreset::H264Mp4AllIntra => push_args(
            args,
            &[
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-tune",
                "fastdecode",
                "-crf",
                "23",
                "-g",
                "1",
                "-keyint_min",
                "1",
                "-sc_threshold",
                "0",
                "-bf",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
            ],
        ),
        ProxyPreset::H264Quicktime => push_args(
            args,
            &[
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-tune",
                "fastdecode",
                "-crf",
                "23",
                "-g",
                "15",
                "-keyint_min",
                "15",
                "-sc_threshold",
                "0",
                "-bf",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
            ],
        ),
        ProxyPreset::Vp8Webm => push_args(
            args,
            &[
                "-c:v",
                "libvpx",
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-b:v",
                "1M",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "libopus",
                "-b:a",
                "96k",
            ],
        ),
        ProxyPreset::Vp9Webm => push_args(
            args,
            &[
                "-c:v",
                "libvpx-vp9",
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-row-mt",
                "1",
                "-crf",
                "34",
                "-b:v",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "libopus",
                "-b:a",
                "96k",
            ],
        ),
    }
}

/// Video codecs AVFoundation (and therefore WKWebView on macOS) decodes from a
/// QuickTime container. AV1 and VP9 are excluded: support depends on hardware.
const REMUX_VIDEO_CODECS: &[&str] = &["h264", "hevc", "prores", "mjpeg"];

/// Audio codecs AVFoundation plays from QuickTime; others are converted to AAC.
const REMUX_COPY_AUDIO_CODECS: &[&str] = &["aac", "mp3", "alac", "ac3", "eac3"];

const REMUX_AUDIO_BITRATE: &str = "192k";

fn codec_is(stream: &MediaStream, codecs: &[&str]) -> bool {
    let codec = stream.codec_name.trim().to_ascii_lowercase();
    codecs.contains(&codec.as_str())
}

/// The video stream the preview plays: the asset's selected stream, else the
/// first video stream that is not attached cover art.
pub(crate) fn proxy_video_stream(project: &MediaDocument) -> Option<&MediaStream> {
    let is_video = |stream: &&MediaStream| stream.codec_type == "video";
    project
        .asset
        .video_stream_index
        .and_then(|index| {
            project
                .streams
                .iter()
                .filter(is_video)
                .find(|stream| stream.index == index)
        })
        .or_else(|| {
            project
                .streams
                .iter()
                .filter(is_video)
                .find(|stream| stream.disposition.get("attached_pic").copied().unwrap_or(0) == 0)
        })
}

/// Whether the source can be remuxed without re-encoding its video.
pub(crate) fn is_remux_eligible(project: &MediaDocument) -> bool {
    proxy_video_stream(project).is_some_and(|stream| codec_is(stream, REMUX_VIDEO_CODECS))
}

/// The preset that will actually run: a remux request for a source whose video
/// codec cannot be stream-copied falls back to the default H.264 proxy.
pub(crate) fn effective_proxy_preset(preset: ProxyPreset, project: &MediaDocument) -> ProxyPreset {
    if preset == ProxyPreset::Remux && !is_remux_eligible(project) {
        ProxyPreset::H264Mp4
    } else {
        preset
    }
}

fn remux_codec_args(args: &mut Vec<String>, project: &MediaDocument) {
    push_args(args, &["-c:v", "copy"]);
    if proxy_video_stream(project).is_some_and(|stream| codec_is(stream, &["hevc"])) {
        // AVFoundation refuses HEVC tagged `hev1`, which Matroska sources produce.
        push_args(args, &["-tag:v", "hvc1"]);
    }
    let audio_streams = project
        .streams
        .iter()
        .filter(|stream| stream.codec_type == "audio");
    for (output_index, stream) in audio_streams.enumerate() {
        if codec_is(stream, REMUX_COPY_AUDIO_CODECS) {
            args.push(format!("-c:a:{output_index}"));
            args.push("copy".to_string());
        } else {
            args.push(format!("-c:a:{output_index}"));
            args.push("aac".to_string());
            args.push(format!("-b:a:{output_index}"));
            args.push(REMUX_AUDIO_BITRATE.to_string());
        }
    }
    push_args(args, &["-movflags", "+faststart"]);
}

/// Builds the complete FFmpeg argument list for a proxy. `options.preset` must
/// already be resolved with `effective_proxy_preset`.
pub(crate) fn proxy_ffmpeg_args(
    project: &MediaDocument,
    options: &ProxyOptions,
    output: &Path,
) -> AppResult<Vec<String>> {
    let mut args = Vec::new();
    push_args(
        &mut args,
        &["-y", "-hide_banner", "-loglevel", "error", "-i"],
    );
    args.push(project.asset.path.clone());
    if options.preset == ProxyPreset::Remux {
        let video_map = proxy_video_stream(project)
            .map(|stream| format!("0:{}", stream.index))
            .unwrap_or_else(|| "0:v:0".to_string());
        args.push("-map".to_string());
        args.push(video_map);
        push_args(&mut args, &["-map", "0:a?", "-sn", "-dn"]);
        remux_codec_args(&mut args, project);
    } else {
        push_args(&mut args, &["-map", "0:v:0", "-map", "0:a:0?", "-sn"]);
        if let Some(video_filter) = proxy_video_filter(options)? {
            args.push("-vf".to_string());
            args.push(video_filter);
        }
        append_proxy_preset_args(&mut args, options.preset, options.watermark);
    }
    args.push(output.to_string_lossy().into_owned());
    Ok(args)
}

pub(crate) fn push_args(args: &mut Vec<String>, values: &[&str]) {
    args.extend(values.iter().map(|value| value.to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(index: i32, codec_type: &str, codec_name: &str) -> MediaStream {
        MediaStream {
            index,
            codec_type: codec_type.to_string(),
            codec_name: codec_name.to_string(),
            avg_frame_rate: None,
            r_frame_rate: None,
            sample_aspect_ratio: None,
            sample_rate: None,
            channel_layout: None,
            language: None,
            title: None,
            width: None,
            height: None,
            channels: None,
            disposition: HashMap::new(),
        }
    }

    fn document(streams: Vec<MediaStream>) -> MediaDocument {
        let video_stream_index = streams
            .iter()
            .find(|stream| stream.codec_type == "video")
            .map(|stream| stream.index);
        MediaDocument {
            asset: MediaAsset {
                id: "asset".to_string(),
                path: "/media/clip.mkv".to_string(),
                file_name: "clip.mkv".to_string(),
                file_size: 1,
                modified_at: 0,
                fingerprint: "fingerprint".to_string(),
                duration_us: 1_000_000,
                start_time_us: 0,
                tape_name: None,
                video_stream_index,
                audio_stream_index: None,
            },
            streams,
            tracks: Vec::new(),
            cues: HashMap::new(),
            cache_dir: "/cache".to_string(),
            proxy_path: None,
        }
    }

    fn options(preset: ProxyPreset) -> ProxyOptions {
        ProxyOptions {
            frame_size: ProxyFrameSize::Half,
            custom_width: 1280,
            custom_height: 720,
            preset,
            watermark: ProxyWatermark::None,
            location: ProxyLocation::SourceProxyFolder,
            custom_location: String::new(),
        }
    }

    fn args_for(project: &MediaDocument, preset: ProxyPreset) -> Vec<String> {
        let options = options(effective_proxy_preset(preset, project));
        proxy_ffmpeg_args(project, &options, Path::new("/out/clip.mov")).unwrap()
    }

    fn has_pair(args: &[String], key: &str, value: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == key && pair[1] == value)
    }

    #[test]
    fn remux_eligibility_follows_the_preview_video_codec() {
        for codec in ["h264", "hevc", "prores", "mjpeg", "H264"] {
            let project = document(vec![stream(0, "video", codec)]);
            assert!(is_remux_eligible(&project), "{codec} should be eligible");
            assert_eq!(
                effective_proxy_preset(ProxyPreset::Remux, &project),
                ProxyPreset::Remux
            );
        }
        for codec in ["av1", "vp9", "vp8", "mpeg2video", ""] {
            let project = document(vec![stream(0, "video", codec)]);
            assert!(
                !is_remux_eligible(&project),
                "{codec} should not be eligible"
            );
            assert_eq!(
                effective_proxy_preset(ProxyPreset::Remux, &project),
                ProxyPreset::H264Mp4
            );
        }
        assert!(!is_remux_eligible(&document(vec![stream(
            0, "audio", "aac"
        )])));
    }

    #[test]
    fn remux_eligibility_ignores_attached_cover_art() {
        let mut cover = stream(0, "video", "mjpeg");
        cover.disposition.insert("attached_pic".to_string(), 1);
        let mut project = document(vec![cover, stream(1, "video", "vp9")]);
        project.asset.video_stream_index = None;
        assert_eq!(
            proxy_video_stream(&project).map(|stream| stream.index),
            Some(1)
        );
        assert!(!is_remux_eligible(&project));
    }

    #[test]
    fn non_remux_presets_are_never_rewritten() {
        let project = document(vec![stream(0, "video", "av1")]);
        assert_eq!(
            effective_proxy_preset(ProxyPreset::Vp9Webm, &project),
            ProxyPreset::Vp9Webm
        );
    }

    #[test]
    fn hevc_remux_copies_video_with_hvc1_tag_and_converts_opus() {
        let project = document(vec![
            stream(0, "video", "hevc"),
            stream(1, "audio", "opus"),
            stream(2, "subtitle", "ass"),
        ]);
        let args = args_for(&project, ProxyPreset::Remux);
        assert!(has_pair(&args, "-map", "0:0"));
        assert!(has_pair(&args, "-map", "0:a?"));
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-tag:v", "hvc1"));
        assert!(has_pair(&args, "-c:a:0", "aac"));
        assert!(has_pair(&args, "-b:a:0", "192k"));
        assert!(has_pair(&args, "-movflags", "+faststart"));
        assert!(args.contains(&"-sn".to_string()));
        assert!(!args.contains(&"-vf".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("/out/clip.mov"));
    }

    #[test]
    fn h264_remux_copies_playable_audio_per_stream() {
        let project = document(vec![
            stream(0, "video", "h264"),
            stream(1, "audio", "aac"),
            stream(2, "audio", "flac"),
            stream(3, "audio", "eac3"),
            stream(4, "audio", "dts"),
        ]);
        let args = args_for(&project, ProxyPreset::Remux);
        assert!(!args.contains(&"-tag:v".to_string()));
        assert!(has_pair(&args, "-c:a:0", "copy"));
        assert!(has_pair(&args, "-c:a:1", "aac"));
        assert!(has_pair(&args, "-c:a:2", "copy"));
        assert!(has_pair(&args, "-c:a:3", "aac"));
        for copied in ["mp3", "alac", "ac3"] {
            let project = document(vec![stream(0, "video", "h264"), stream(1, "audio", copied)]);
            assert!(has_pair(
                &args_for(&project, ProxyPreset::Remux),
                "-c:a:0",
                "copy"
            ));
        }
        for converted in ["vorbis", "pcm_s16le"] {
            let project = document(vec![
                stream(0, "video", "h264"),
                stream(1, "audio", converted),
            ]);
            assert!(has_pair(
                &args_for(&project, ProxyPreset::Remux),
                "-c:a:0",
                "aac"
            ));
        }
    }

    #[test]
    fn ineligible_remux_request_builds_the_h264_proxy() {
        let project = document(vec![stream(0, "video", "av1"), stream(1, "audio", "opus")]);
        let args = args_for(&project, ProxyPreset::Remux);
        assert!(has_pair(&args, "-c:v", "libx264"));
        assert!(has_pair(&args, "-vf", "scale=trunc(iw/4)*2:-2"));
        assert!(has_pair(&args, "-map", "0:a:0?"));
        assert!(!has_pair(&args, "-c:v", "copy"));
    }

    #[test]
    fn remux_skips_scaling_and_writes_a_distinct_quicktime_file() {
        let project = document(vec![stream(0, "video", "h264")]);
        assert_eq!(
            proxy_video_filter(&options(ProxyPreset::Remux)).unwrap(),
            None
        );
        assert_eq!(proxy_extension(ProxyPreset::Remux), "mov");
        let preferences = Preferences::default();
        let remux =
            proxy_output_path(&project, &preferences, &options(ProxyPreset::Remux)).unwrap();
        let lossy = proxy_output_path(&project, &preferences, &options(ProxyPreset::H264Quicktime))
            .unwrap();
        assert_eq!(remux, PathBuf::from("/media/Proxy/clip_Remux.mov"));
        assert_ne!(remux, lossy);
    }

    #[test]
    fn remux_preset_serializes_for_the_frontend() {
        assert_eq!(
            serde_json::to_string(&ProxyPreset::Remux).unwrap(),
            "\"remux\""
        );
    }
}
