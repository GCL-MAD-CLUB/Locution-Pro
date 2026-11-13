//! Logical task registration, cancellation and cleanup ownership.
use super::{kill_process_tree, AppState, RunningFfmpeg, RunningTask, TaskGuard};
use crate::error::{app_error, AppResult, ErrorCode};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

pub(crate) fn register_task<'a>(task_id: &str, state: &'a AppState) -> AppResult<TaskGuard<'a>> {
    if task_id.trim().is_empty() {
        return Err(app_error(
            ErrorCode::TaskIdInvalid,
            "Task identifier is empty",
        ));
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let mut tasks = state.running_tasks.lock().map_err(|_| {
        app_error(
            ErrorCode::TaskStateUnavailable,
            "Task state lock is poisoned",
        )
    })?;
    if tasks.contains_key(task_id) {
        return Err(app_error(
            ErrorCode::TaskAlreadyRunning,
            format!("Task identifier is already registered: {task_id}"),
        ));
    }
    tasks.insert(
        task_id.to_string(),
        RunningTask {
            cancel: cancel.clone(),
            cleanup_paths: Vec::new(),
        },
    );

    Ok(TaskGuard {
        task_id: task_id.to_string(),
        cancel,
        state,
    })
}

pub(crate) fn register_task_cleanup_paths(
    task_id: &str,
    paths: &[PathBuf],
    state: &AppState,
) -> AppResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut tasks = state.running_tasks.lock().map_err(|_| {
        app_error(
            ErrorCode::TaskStateUnavailable,
            "Task state lock is poisoned",
        )
    })?;
    let task = tasks.get_mut(task_id).ok_or_else(|| {
        app_error(
            ErrorCode::TaskNotFound,
            format!("Task identifier is not registered: {task_id}"),
        )
    })?;
    for path in paths {
        if !task.cleanup_paths.contains(path) {
            task.cleanup_paths.push(path.clone());
        }
    }
    Ok(())
}

pub(crate) fn ensure_not_cancelled(cancel: &AtomicBool) -> AppResult<()> {
    if cancel.load(Ordering::SeqCst) {
        Err(app_error(
            ErrorCode::TaskCancelled,
            "Task cancellation was requested",
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn check_optional_cancel(cancel: Option<&AtomicBool>) -> AppResult<()> {
    cancel.map_or(Ok(()), ensure_not_cancelled)
}

pub(crate) async fn spawn_blocking_cancellable<T, F>(
    cancel: Arc<AtomicBool>,
    operation: &'static str,
    work: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AtomicBool) -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        ensure_not_cancelled(&cancel)?;
        let result = work(&cancel)?;
        ensure_not_cancelled(&cancel)?;
        Ok(result)
    })
    .await
    .map_err(|error| {
        app_error(
            ErrorCode::BlockingTaskFailed,
            format!("Blocking task join failed during {operation}: {error}"),
        )
    })?
}

pub(crate) fn register_running_ffmpeg(
    state: &AppState,
    id: String,
    task_id: String,
    cancel: Arc<AtomicBool>,
    pid: Option<u32>,
    cleanup_paths: Vec<PathBuf>,
) -> AppResult<()> {
    ensure_not_cancelled(&cancel)?;
    register_task_cleanup_paths(&task_id, &cleanup_paths, state)?;
    let mut running = state.running_ffmpeg.lock().map_err(|_| {
        app_error(
            ErrorCode::TaskStateUnavailable,
            "FFmpeg task state lock is poisoned",
        )
    })?;
    running.insert(
        id.clone(),
        RunningFfmpeg {
            task_id,
            cancel: cancel.clone(),
            pid,
            cleanup_paths,
        },
    );
    if cancel.load(Ordering::SeqCst) {
        running.remove(&id);
        return Err(app_error(
            ErrorCode::TaskCancelled,
            "Task cancellation was requested",
        ));
    }
    Ok(())
}

pub(crate) fn clear_running_ffmpeg(state: &AppState, id: &str) {
    match state.running_ffmpeg.lock() {
        Ok(mut running) => {
            running.remove(id);
        }
        Err(_) => {
            let _ = app_error(
                ErrorCode::TaskStateUnavailable,
                "FFmpeg task state lock is poisoned during cleanup",
            );
        }
    }
}

/// Work taken out of shared task state. A second claim cannot see it, so
/// closing the window and a frontend cancel cannot kill or delete twice.
pub(crate) struct ClaimedCancellation {
    pub(crate) found: bool,
    processes: Vec<RunningFfmpeg>,
    cleanup_paths: Vec<PathBuf>,
}

impl ClaimedCancellation {
    pub(crate) fn has_cleanup(&self) -> bool {
        !self.processes.is_empty() || !self.cleanup_paths.is_empty()
    }
}

/// `task_id` of `None` claims every registered task.
/// Cleanup paths are removed from the logical task so `TaskGuard`'s drop only
/// deletes paths registered after this claim.
pub(crate) fn claim_cancellation(
    task_id: Option<&str>,
    state: &AppState,
) -> AppResult<ClaimedCancellation> {
    let mut found = false;
    let mut cleanup_paths = Vec::new();
    {
        let mut tasks = state.running_tasks.lock().map_err(|_| {
            app_error(
                ErrorCode::TaskStateUnavailable,
                "Task state lock is poisoned",
            )
        })?;
        for (id, task) in tasks.iter_mut() {
            if task_id.is_some_and(|wanted| wanted != id.as_str()) {
                continue;
            }
            found = true;
            task.cancel.store(true, Ordering::SeqCst);
            cleanup_paths.append(&mut task.cleanup_paths);
        }
    }

    let processes = {
        let mut running = state.running_ffmpeg.lock().map_err(|_| {
            app_error(
                ErrorCode::TaskStateUnavailable,
                "FFmpeg task state lock is poisoned",
            )
        })?;
        let matching_ids = running
            .iter()
            .filter(|(_, task)| task_id.is_none_or(|id| task.task_id == id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        matching_ids
            .into_iter()
            .filter_map(|id| running.remove(&id))
            .collect::<Vec<_>>()
    };
    if !processes.is_empty() {
        found = true;
    }
    for process in &processes {
        for path in &process.cleanup_paths {
            if !cleanup_paths.contains(path) {
                cleanup_paths.push(path.clone());
            }
        }
    }
    Ok(ClaimedCancellation {
        found,
        processes,
        cleanup_paths,
    })
}

pub(crate) fn apply_cancellation(claimed: ClaimedCancellation) {
    for task in claimed.processes {
        task.cancel.store(true, Ordering::SeqCst);
        if let Some(pid) = task.pid {
            kill_process_tree(pid);
        }
    }
    remove_cleanup_paths(&claimed.cleanup_paths);
}

pub(crate) fn cancel_all_tasks(state: &AppState) -> AppResult<bool> {
    let claimed = claim_cancellation(None, state)?;
    let found = claimed.found;
    if claimed.has_cleanup() {
        apply_cancellation(claimed);
    }
    Ok(found)
}

pub(crate) fn remove_cleanup_paths(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        if path.is_dir() {
            if let Err(error) = fs::remove_dir_all(path) {
                let _ = app_error(
                    ErrorCode::TaskCleanupFailed,
                    format!(
                        "Failed to remove task cleanup directory {}: {error}",
                        path.display()
                    ),
                );
            }
        } else {
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    let _ = app_error(
                        ErrorCode::TaskCleanupFailed,
                        format!(
                            "Failed to remove task cleanup file {}: {error}",
                            path.display()
                        ),
                    );
                }
            }
        }
    }
}

pub(crate) async fn remove_cleanup_paths_async(paths: Vec<PathBuf>) {
    if let Err(error) = tokio::task::spawn_blocking(move || remove_cleanup_paths(&paths)).await {
        let _ = app_error(
            ErrorCode::BlockingTaskFailed,
            format!("Task cleanup worker failed to join: {error}"),
        );
    }
}

/// Removes only the paths that have completed successfully.  Parallel export
/// jobs must not clear each other's in-flight cleanup entries.
pub(crate) fn unregister_task_cleanup_paths(
    task_id: &str,
    completed_paths: &[PathBuf],
    state: &AppState,
) -> AppResult<()> {
    if completed_paths.is_empty() {
        return Ok(());
    }
    let mut tasks = state.running_tasks.lock().map_err(|_| {
        app_error(
            ErrorCode::TaskStateUnavailable,
            "Task state lock is poisoned",
        )
    })?;
    if let Some(task) = tasks.get_mut(task_id) {
        task.cleanup_paths
            .retain(|path| !completed_paths.contains(path));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TemporaryDirectory(PathBuf);

    impl TemporaryDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "locution-pro-cancel-{}-{}",
                std::process::id(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("temporary cancellation directory");
            fs::write(path.join("partial.mp4"), b"partial").expect("partial output");
            Self(path)
        }
    }

    impl Drop for TemporaryDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn register_running<'a>(state: &'a AppState, task_id: &str, directory: &Path) -> TaskGuard<'a> {
        let guard = register_task(task_id, state).expect("task");
        register_running_ffmpeg(
            state,
            format!("process-{task_id}"),
            task_id.to_string(),
            guard.cancel_token(),
            None,
            vec![directory.to_path_buf()],
        )
        .expect("ffmpeg registration");
        guard
    }

    #[test]
    fn one_claim_deletes_cleanup_output_and_a_second_claim_finds_nothing_to_repeat() {
        let state = AppState::for_tests();
        let directory = TemporaryDirectory::new();
        let _guard = register_running(&state, "export:1", &directory.0);

        let first = claim_cancellation(Some("export:1"), &state).expect("first claim");
        assert!(first.found);
        assert!(first.has_cleanup());
        apply_cancellation(first);
        assert!(!directory.0.exists());
        assert!(state
            .running_tasks
            .lock()
            .expect("tasks")
            .get("export:1")
            .expect("logical task")
            .cleanup_paths
            .is_empty());
        assert!(state.running_ffmpeg.lock().expect("ffmpeg").is_empty());

        let second = claim_cancellation(None, &state).expect("second claim");
        assert!(second.found);
        assert!(!second.has_cleanup());
    }

    #[test]
    fn cancelling_one_task_leaves_another_tasks_process_and_output() {
        let state = AppState::for_tests();
        let export_dir = TemporaryDirectory::new();
        let proxy_dir = TemporaryDirectory::new();
        let _export = register_running(&state, "export:1", &export_dir.0);
        let _proxy = register_running(&state, "proxy:1", &proxy_dir.0);

        let claimed = claim_cancellation(Some("export:1"), &state).expect("claim");
        apply_cancellation(claimed);

        assert!(!export_dir.0.exists());
        assert!(proxy_dir.0.join("partial.mp4").is_file());
        let running = state.running_ffmpeg.lock().expect("ffmpeg");
        assert!(running.contains_key("process-proxy:1"));
        assert!(!running.contains_key("process-export:1"));
    }
}
