use super::super::*;
use crate::project_file::{
    auto_save_project, normalize_project_path, read_project_file, write_project_file,
};

/// Tells the frontend a launch project is waiting in `take_launch_project_path`.
#[cfg(target_os = "macos")]
const LAUNCH_PROJECT_EVENT: &str = "launch-project-path";

/// macOS hands Finder opens (double-click, Dock drop, Open With) to the app as
/// Apple Events, at launch or while running, instead of command-line arguments.
#[cfg(target_os = "macos")]
pub(crate) fn receive_opened_files(app: &tauri::AppHandle, urls: &[tauri::Url]) {
    use tauri::Emitter;
    let Some(path) = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .find_map(project_file_path)
    else {
        return;
    };
    let Some(state) = app.try_state::<AppState>() else {
        // Cold launch: AppState picks the path up when setup creates it, and
        // the frontend reads it at startup, so no event is needed.
        defer_launch_project(path);
        return;
    };
    match state.launch_project_path.lock() {
        Ok(mut launch) => *launch = Some(path),
        Err(_) => {
            app_error(
                ErrorCode::LaunchPathStateUnavailable,
                "Launch project path state lock is poisoned",
            );
            return;
        }
    }
    if let Err(error) = app.emit(LAUNCH_PROJECT_EVENT, ()) {
        app_error(
            ErrorCode::EventEmitFailed,
            format!("Failed to announce the opened project: {error}"),
        );
    }
}

#[tauri::command]
pub(crate) fn take_launch_project_path(
    state: tauri::State<'_, AppState>,
) -> CommandResult<Option<String>> {
    state
        .launch_project_path
        .lock()
        .map_err(|_| {
            app_error(
                ErrorCode::LaunchPathStateUnavailable,
                "Launch project path state lock is poisoned",
            )
        })
        .map(|mut path| path.take())
}

#[tauri::command]
pub(crate) async fn save_project_file(
    path: String,
    workspace: ProjectWorkspace,
    project_id: String,
) -> CommandResult<String> {
    let normalized_path = normalize_project_path(&path)?;
    let output_path = normalized_path.clone();
    tokio::task::spawn_blocking(move || write_project_file(&output_path, workspace, &project_id))
        .await
        .map_err(|error| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                format!("Project save task failed: {error}"),
            )
        })??;
    Ok(normalized_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) async fn auto_save_project_snapshot(
    project_name: String,
    workspace: ProjectWorkspace,
    project_id: String,
    project_path: Option<String>,
    state: tauri::State<'_, AppState>,
) -> CommandResult<bool> {
    let (directory, max_snapshots, save_current) = {
        let preferences = state.preferences.lock().map_err(|_| {
            app_error(
                ErrorCode::PreferencesStateUnavailable,
                "Preferences state lock is poisoned",
            )
        })?;
        if !preferences.auto_save_enabled {
            return Ok(false);
        }
        (
            configured_auto_save_directory(&preferences),
            preferences.auto_save_max_snapshots as usize,
            preferences.auto_save_current_project,
        )
    };
    let current_path = if save_current {
        project_path
            .filter(|path| !path.trim().is_empty())
            .map(|path| normalize_project_path(&path))
            .transpose()?
    } else {
        None
    };
    tokio::task::spawn_blocking(move || {
        auto_save_project(
            &directory,
            &project_name,
            workspace,
            &project_id,
            max_snapshots,
            current_path.as_deref(),
        )
    })
    .await
    .map_err(|error| {
        app_error(
            ErrorCode::BlockingTaskFailed,
            format!("Project auto-save task failed: {error}"),
        )
    })?
}

#[tauri::command]
pub(crate) async fn open_project_file(path: String) -> CommandResult<OpenProjectResult> {
    let input_path = PathBuf::from(path);
    let read_path = input_path.clone();
    let (mut workspace, project_id, migrated) =
        tokio::task::spawn_blocking(move || read_project_file(&read_path))
            .await
            .map_err(|error| {
                app_error(
                    ErrorCode::BlockingTaskFailed,
                    format!("Project open task failed: {error}"),
                )
            })??;
    let mut warnings = Vec::new();

    for project in &mut workspace.projects {
        for track in &mut project.tracks {
            if matches!(&track.source_type, SubtitleSourceType::Embedded) {
                track.source_path = None;
            }
            if let Some(detail) = track.warning.take() {
                tracing::warn!(
                    notice_code = "LEGACY_TRACK_WARNING_SANITIZED",
                    track_id = %track.id,
                    detail = %detail,
                    "sanitized persisted subtitle warning"
                );
                let public_message = match &track.source_type {
                    SubtitleSourceType::Embedded => match track.stream_index {
                        Some(stream_index) => format!("字幕流 {stream_index} 当前不可用"),
                        None => "内嵌字幕当前不可用".to_string(),
                    },
                    SubtitleSourceType::External => {
                        let display_name = track
                            .source_path
                            .as_deref()
                            .and_then(|path| Path::new(path).file_name())
                            .and_then(|value| value.to_str())
                            .or_else(|| {
                                track
                                    .title
                                    .as_deref()
                                    .and_then(|title| Path::new(title).file_name())
                                    .and_then(|value| value.to_str())
                            })
                            .unwrap_or("字幕文件");
                        format!("外挂字幕当前不可用：{display_name}")
                    }
                };
                track.warning = Some(public_message);
            }
        }
    }
    for item in &mut workspace.media_bin.items {
        let is_virtual_reference = item.origin == MediaBinItemOrigin::Decomposed
            && item.source_video_id.is_some()
            && item.stream_index.is_some()
            && matches!(
                item.kind,
                MediaBinItemKind::Audio | MediaBinItemKind::Subtitle
            );
        if is_virtual_reference {
            item.path.clear();
            item.extracted = false;
            item.offline = false;
        }
    }

    for project in &workspace.projects {
        let media_path = Path::new(&project.asset.path);
        let was_set_offline = workspace.media_bin.items.iter().any(|item| {
            item.offline
                && (item.id == project.asset.id
                    || item.source_video_id.as_deref() == Some(project.asset.id.as_str()))
        });
        if was_set_offline {
            continue;
        }
        if !media_path.is_file() {
            warnings.push(UserNotice::warning_with_detail(
                "PROJECT_MEDIA_MISSING",
                format!("项目引用的媒体文件不存在：{}", project.asset.file_name),
                format!("missing media path: {}", project.asset.path),
            ));
        } else {
            match fs::metadata(media_path) {
                Ok(metadata) => {
                    if metadata.len() as i64 != project.asset.file_size
                        || modified_secs(&metadata) != project.asset.modified_at
                    {
                        warnings.push(UserNotice::warning(
                            "PROJECT_MEDIA_CHANGED",
                            format!("源媒体自项目保存后已发生变化：{}", project.asset.file_name),
                        ));
                    }
                }
                Err(error) => {
                    app_error(
                        ErrorCode::MediaReadFailed,
                        format!(
                            "Failed to read project media metadata for {}: {error}",
                            media_path.display()
                        ),
                    );
                }
            }
        }
    }

    let project_paths = workspace
        .projects
        .iter()
        .map(|project| project.asset.path.clone())
        .collect::<HashSet<_>>();
    for item in &mut workspace.media_bin.items {
        if item.offline || item.path.is_empty() {
            continue;
        }
        if !Path::new(&item.path).is_file() {
            item.offline = true;
            if !project_paths.contains(&item.path) {
                warnings.push(UserNotice::warning_with_detail(
                    "PROJECT_ITEM_MISSING",
                    format!("项目引用的文件不存在：{}", item.file_name),
                    format!("missing project item path: {}", item.path),
                ));
            }
        }
    }

    // A legacy file's id was generated in memory; write it back so the id stays
    // stable across opens (and the file's recorded per-project state keeps its
    // identity). Best-effort: a read-only file must still open.
    if migrated {
        let write_path = input_path.clone();
        let write_workspace = workspace.clone();
        let write_project_id = project_id.clone();
        if let Err(error) = tokio::task::spawn_blocking(move || {
            write_project_file(&write_path, write_workspace, &write_project_id)
        })
        .await
        .map_err(|error| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                format!("Project id backfill task failed: {error}"),
            )
        })? {
            warnings.push(UserNotice::warning_with_detail(
                "PROJECT_ID_BACKFILL_FAILED",
                "无法将项目标识写回旧项目文件，打开后首次保存将固定该标识",
                error.detail(),
            ));
        }
    }

    Ok(OpenProjectResult {
        path: input_path.to_string_lossy().into_owned(),
        project_id,
        workspace,
        warnings,
    })
}

/// Read only the size of each recent project; missing files stay visible in history.
#[tauri::command]
pub(crate) async fn recent_project_sizes(paths: Vec<String>) -> CommandResult<Vec<Option<u64>>> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| {
                fs::metadata(path)
                    .ok()
                    .filter(|metadata| metadata.is_file())
                    .map(|metadata| metadata.len())
            })
            .collect()
    })
    .await
    .map_err(|error| {
        app_error(
            ErrorCode::BlockingTaskFailed,
            format!("Recent project metadata task failed: {error}"),
        )
    })
}
