use super::super::*;

#[tauri::command]
pub(crate) async fn generate_proxy(
    media_sources: crate::MediaSources,
    asset_id: String,
    options: ProxyOptions,
    task_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<ProxyResult> {
    let task = register_task(&task_id, state.inner())?;
    let preferences = preferences_clone(&state)?;
    let project = media_sources.get(&asset_id)?.clone();
    let proxy_path = proxy_output_path(&project, &preferences, &options)?;
    emit_ffmpeg_progress(&app, &task_id, 0.0);
    if let Some(parent) = proxy_path.parent() {
        let parent = parent.to_path_buf();
        spawn_blocking_cancellable(
            task.cancel_token(),
            "create proxy output directory",
            move |_| {
                fs::create_dir_all(&parent).map_err(|error| {
                    app_error(
                        ErrorCode::ProxyWriteFailed,
                        format!(
                            "Failed to create proxy output directory {}: {error}",
                            parent.display()
                        ),
                    )
                })
            },
        )
        .await?;
    }
    task.check_cancelled()?;
    if !proxy_path.exists() {
        let mut args = vec![
            "-y".to_string(),
            "-hide_banner".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-i".to_string(),
            project.asset.path.clone(),
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            "0:a:0?".to_string(),
            "-sn".to_string(),
        ];
        if let Some(video_filter) = proxy_video_filter(&options)? {
            args.push("-vf".to_string());
            args.push(video_filter);
        }
        append_proxy_preset_args(&mut args, options.preset, options.watermark);
        args.push(proxy_path.to_string_lossy().into_owned());

        let program = ffmpeg_program(&preferences);
        run_status_with_ffmpeg_progress(
            &program,
            &args,
            FfmpegProgressContext {
                app: &app,
                state: state.inner(),
                task_id: &task_id,
                watchdog_label: format!("proxy -> {}", proxy_path.display()),
                cancel: task.cancel_token(),
                base_progress: 0.0,
                progress_span: 1.0,
                duration_us: project.asset.duration_us,
                cleanup_paths: vec![proxy_path.clone()],
                progress_callback: None,
            },
        )
        .await?;
    }

    task.check_cancelled()?;
    let proxy_string = proxy_path.to_string_lossy().into_owned();
    emit_ffmpeg_progress(&app, &task_id, 1.0);
    Ok(ProxyResult {
        proxy_path: proxy_string,
    })
}
