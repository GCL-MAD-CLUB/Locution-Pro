use super::super::*;

#[tauri::command]
pub(crate) async fn demux_media_streams(
    media_sources: crate::MediaSources,
    asset_id: String,
    task_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<DemuxMediaResult> {
    let task = register_task(&task_id, state.inner())?;
    let mut project = media_sources.get(&asset_id)?.clone();
    emit_ffmpeg_progress(&app, &task_id, 0.0);
    task.check_cancelled()?;

    let source_stem = Path::new(&project.asset.file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_string());
    let audio_tracks = project
        .streams
        .iter()
        .filter(|stream| stream.codec_type == "audio")
        .map(|stream| DemuxedAudioTrack {
            file_name: format!("{source_stem}_音轨_{}", stream.index),
            duration_us: project.asset.duration_us,
            stream_index: stream.index,
            codec: stream.codec_name.clone(),
            language: stream.language.clone(),
            title: stream.title.clone(),
        })
        .collect::<Vec<_>>();

    let subtitle_tracks = project
        .tracks
        .iter_mut()
        .filter_map(|track| {
            if matches!(&track.source_type, SubtitleSourceType::Embedded) {
                track.source_path = None;
                Some(track.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    task.check_cancelled()?;
    emit_ffmpeg_progress(&app, &task_id, 1.0);

    Ok(DemuxMediaResult {
        audio_tracks,
        subtitle_tracks,
    })
}

#[tauri::command]
pub(crate) async fn add_external_subtitles(
    media_sources: crate::MediaSources,
    asset_id: String,
    paths: Vec<String>,
    task_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<AddExternalSubtitlesResult> {
    let task = register_task(&task_id, state.inner())?;
    media_sources.get(&asset_id)?;
    let mut new_tracks = Vec::new();
    let mut new_cues: HashMap<String, Vec<SubtitleCue>> = HashMap::new();
    let mut warnings = Vec::new();

    emit_ffmpeg_progress(&app, &task_id, 0.0);
    let path_total = paths.len().max(1);
    for (index, path) in paths.into_iter().enumerate() {
        task.check_cancelled()?;
        let (track, cues, warning) =
            load_external_subtitle_async(path, asset_id.clone(), task.cancel_token()).await?;
        if let Some(message) = warning {
            warnings.push(message);
        }
        if !cues.is_empty() {
            new_cues.insert(track.id.clone(), cues);
        }
        new_tracks.push(track);
        emit_ffmpeg_progress(&app, &task_id, (index + 1) as f64 * 0.9 / path_total as f64);
    }

    task.check_cancelled()?;
    emit_ffmpeg_progress(&app, &task_id, 1.0);
    Ok(AddExternalSubtitlesResult {
        tracks: new_tracks,
        cues: new_cues,
        warnings,
    })
}
