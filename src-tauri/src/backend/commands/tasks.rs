use super::super::*;

#[tauri::command]
pub(crate) async fn cancel_task(
    task_id: String,
    state: tauri::State<'_, AppState>,
) -> CommandResult<bool> {
    let claimed = claim_cancellation(Some(&task_id), state.inner())?;
    let found = claimed.found;
    if claimed.has_cleanup() {
        tokio::task::spawn_blocking(move || apply_cancellation(claimed))
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
