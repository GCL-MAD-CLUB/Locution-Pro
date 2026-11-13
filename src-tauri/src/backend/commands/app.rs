use super::super::*;

#[tauri::command]
pub(crate) fn get_preferences(state: tauri::State<'_, AppState>) -> CommandResult<Preferences> {
    state
        .preferences
        .lock()
        .map_err(|_| {
            app_error(
                ErrorCode::PreferencesStateUnavailable,
                "Preferences state lock is poisoned",
            )
        })
        .map(|preferences| preferences.clone())
}

#[tauri::command]
pub(crate) fn take_preferences_startup_error(
    state: tauri::State<'_, AppState>,
) -> CommandResult<()> {
    let error = state
        .startup_preferences_error
        .lock()
        .map_err(|_| {
            app_error(
                ErrorCode::PreferencesStateUnavailable,
                "Startup preferences diagnostic lock is poisoned",
            )
        })?
        .take();
    match error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[tauri::command]
pub(crate) async fn update_preferences(
    preferences: Preferences,
    task_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<Preferences> {
    let task = register_task(&task_id, state.inner())?;
    emit_ffmpeg_progress(&app, &task_id, 0.0);
    let cancel = task.cancel_token();
    let normalized = tokio::task::spawn_blocking(move || {
        ensure_not_cancelled(&cancel)?;
        let normalized = normalize_preferences(preferences)?;
        ensure_not_cancelled(&cancel)?;
        save_preferences(&normalized)?;
        ensure_not_cancelled(&cancel)?;
        Ok::<_, AppError>(normalized)
    })
    .await
    .map_err(|error| {
        app_error(
            ErrorCode::BlockingTaskFailed,
            format!("Preferences save task failed: {error}"),
        )
    })??;
    task.check_cancelled()?;
    *state.preferences.lock().map_err(|_| {
        app_error(
            ErrorCode::PreferencesStateUnavailable,
            "Preferences state lock is poisoned",
        )
    })? = normalized.clone();
    emit_ffmpeg_progress(&app, &task_id, 1.0);
    Ok(normalized)
}

#[tauri::command]
pub(crate) fn path_is_file(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
pub(crate) fn path_is_directory(path: String) -> CommandResult<bool> {
    Ok(Path::new(&path).is_dir())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum KnownFolderKind {
    Desktop,
    Documents,
    User,
    Videos,
    Pictures,
}

/// Resolves a well-known Windows folder to an absolute path for the 导出到
/// dropdown. Non-Windows platforms (the codebase still compiles cross-platform)
/// fall back to HOME-relative paths.
#[tauri::command]
pub(crate) fn resolve_known_folder(kind: KnownFolderKind) -> CommandResult<String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::PWSTR;
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{
            FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Pictures, FOLDERID_Profile,
            FOLDERID_Videos, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG,
        };

        let id = match kind {
            KnownFolderKind::Desktop => &FOLDERID_Desktop,
            KnownFolderKind::Documents => &FOLDERID_Documents,
            KnownFolderKind::User => &FOLDERID_Profile,
            KnownFolderKind::Videos => &FOLDERID_Videos,
            KnownFolderKind::Pictures => &FOLDERID_Pictures,
        };
        // The returned PWSTR is CoTaskMemAlloc'd and must be freed below.
        let path: PWSTR =
            unsafe { SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None) }.map_err(|error| {
                app_error(
                    ErrorCode::ExportDestinationResolveFailed,
                    format!("Failed to resolve known folder {kind:?}: {error}"),
                )
            })?;
        // The CoTaskMemAlloc'd buffer must be freed on every return path, including
        // when the path cannot be decoded to a UTF-8 string.
        let result = match unsafe { path.to_string() } {
            Ok(value) => value,
            Err(error) => {
                unsafe { CoTaskMemFree(Some(path.as_ptr().cast())) };
                return Err(app_error(
                    ErrorCode::ExportDestinationResolveFailed,
                    format!("Invalid known folder path: {error}"),
                ));
            }
        };
        unsafe { CoTaskMemFree(Some(path.as_ptr().cast())) }
        Ok(result)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let base = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        let dir = match kind {
            KnownFolderKind::Desktop => base.join("Desktop"),
            KnownFolderKind::Documents => base.join("Documents"),
            KnownFolderKind::User => base,
            KnownFolderKind::Videos => base.join("Videos"),
            KnownFolderKind::Pictures => base.join("Pictures"),
        };
        Ok(dir.to_string_lossy().into_owned())
    }
}

#[tauri::command]
pub(crate) fn reveal_in_file_manager(path: String) -> CommandResult<()> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(app_error(
            ErrorCode::FileNotFound,
            format!("File to reveal does not exist: {}", target.display()),
        ));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg("/select,").arg(&target);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(&target);
        command
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(target.parent().unwrap_or_else(|| Path::new(".")));
        command
    };

    command.spawn().map(|_| ()).map_err(|error| {
        app_error(
            ErrorCode::FileRevealFailed,
            format!("Failed to reveal file {}: {error}", target.display()),
        )
    })
}

fn spawn_system_opener(mut command: StdCommand) -> std::io::Result<()> {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command.spawn().map(|_| ())
}

fn external_url_supported(url: &str) -> bool {
    if url
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        return false;
    }
    url.get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
        || url
            .get(..7)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
}

fn system_url_command(url: &str) -> StdCommand {
    #[cfg(target_os = "windows")]
    {
        let mut command = StdCommand::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = StdCommand::new("open");
        command.arg(url);
        command
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let mut command = StdCommand::new("xdg-open");
        command.arg(url);
        command
    }
}

/// Opens a validated web URL in the user's default browser instead of the
/// application webview.
#[tauri::command]
pub(crate) fn open_external_url(url: String) -> CommandResult<()> {
    if !external_url_supported(&url) {
        return Err(app_error(
            ErrorCode::ExternalUrlInvalid,
            format!("Only HTTP and HTTPS URLs can be opened externally: {url}"),
        ));
    }
    let target = url.clone();
    spawn_system_opener(system_url_command(&url)).map_err(|error| {
        app_error(
            ErrorCode::ExternalUrlOpenFailed,
            format!("Failed to open {target} with the system handler: {error}"),
        )
    })
}

#[tauri::command]
pub(crate) fn open_user_guide() -> CommandResult<()> {
    const USER_GUIDE_URL: &str = "https://helpx.locution.dpdns.org/";

    spawn_system_opener(system_url_command(USER_GUIDE_URL)).map_err(|error| {
        app_error(
            ErrorCode::DocumentationOpenFailed,
            format!("Failed to open the Locution Pro user guide with the system handler: {error}"),
        )
    })
}

#[tauri::command]
pub(crate) fn open_log_directory(app: tauri::AppHandle) -> CommandResult<()> {
    let log_dir = app.path().app_log_dir().map_err(|error| {
        app_error(
            ErrorCode::LogDirectoryOpenFailed,
            format!("Failed to resolve the application log directory: {error}"),
        )
    })?;
    std::fs::create_dir_all(&log_dir).map_err(|error| {
        app_error(
            ErrorCode::LogDirectoryOpenFailed,
            format!(
                "Failed to prepare application log directory {}: {error}",
                log_dir.display()
            ),
        )
    })?;

    #[cfg(target_os = "windows")]
    let command = {
        let mut command = StdCommand::new("explorer");
        command.arg(&log_dir);
        command
    };
    #[cfg(target_os = "macos")]
    let command = {
        let mut command = StdCommand::new("open");
        command.arg(&log_dir);
        command
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let command = {
        let mut command = StdCommand::new("xdg-open");
        command.arg(&log_dir);
        command
    };

    spawn_system_opener(command).map_err(|error| {
        app_error(
            ErrorCode::LogDirectoryOpenFailed,
            format!(
                "Failed to open application log directory {} with the system handler: {error}",
                log_dir.display()
            ),
        )
    })
}

pub(crate) fn preferences_clone(state: &tauri::State<'_, AppState>) -> AppResult<Preferences> {
    state
        .preferences
        .lock()
        .map_err(|_| {
            app_error(
                ErrorCode::PreferencesStateUnavailable,
                "Preferences state lock is poisoned",
            )
        })
        .map(|preferences| preferences.clone())
}

#[tauri::command]
pub(crate) fn play_system_sound() -> CommandResult<bool> {
    #[cfg(windows)]
    {
        const MB_ICONEXCLAMATION: u32 = 0x00000030;

        extern "system" {
            fn MessageBeep(u_type: u32) -> i32;
        }

        unsafe {
            if MessageBeep(MB_ICONEXCLAMATION) == 0 {
                let error = std::io::Error::last_os_error();
                return Err(app_error(
                    ErrorCode::SystemSoundPlayFailed,
                    format!("Failed to play system warning sound: {error}"),
                ));
            }
        }
        Ok(true)
    }

    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_validation_accepts_http_urls_only() {
        assert!(external_url_supported(
            "https://space.bilibili.com/99325557"
        ));
        assert!(external_url_supported("HTTP://example.com/path?query=1"));
        assert!(!external_url_supported("file:///C:/Windows/System32"));
        assert!(!external_url_supported("javascript:alert(1)"));
        assert!(!external_url_supported("https://example.com/ spaced"));
        assert!(!external_url_supported("https://example.com/\n"));
        assert!(!external_url_supported(""));
    }
}
