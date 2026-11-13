use super::super::*;

#[tauri::command]
pub(crate) async fn cancel_task(
    task_id: String,
    state: tauri::State<'_, AppState>,
) -> CommandResult<bool> {
    let (found, processes, cleanup_paths) = take_task_for_cancellation(&task_id, state.inner())?;
    if !processes.is_empty() || !cleanup_paths.is_empty() {
        tokio::task::spawn_blocking(move || {
            stop_running_ffmpeg(processes);
            remove_cleanup_paths(&cleanup_paths);
        })
        .await
        .map_err(|error| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                format!("Task cancellation cleanup failed: {error}"),
            )
        })?;
    }
    Ok(found)
}
