use super::super::*;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaLinkFile {
    path: String,
    file_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaLinkFileMetadata {
    path: String,
    duration_us: i64,
    start_time_us: i64,
    tape_name: Option<String>,
    has_video: bool,
    has_audio: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaBrowserEntry {
    path: String,
    name: String,
    is_directory: bool,
    is_hidden: bool,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaBrowserDirectory {
    directory: String,
    parent: Option<String>,
    entries: Vec<MediaBrowserEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MediaBrowserRoot {
    path: String,
    name: String,
}

fn normalized_extensions(extensions: Vec<String>) -> HashSet<String> {
    extensions
        .into_iter()
        .map(|extension| {
            extension
                .trim()
                .trim_start_matches('.')
                .to_ascii_lowercase()
        })
        .filter(|extension| !extension.is_empty())
        .collect()
}

fn media_link_files_in_directory(
    directory: &Path,
    extensions: &HashSet<String>,
) -> AppResult<Vec<MediaLinkFile>> {
    if !directory.is_dir() {
        return Err(app_error(
            ErrorCode::MediaNotFound,
            format!(
                "Media link directory does not exist: {}",
                directory.display()
            ),
        ));
    }

    let entries = fs::read_dir(directory).map_err(|error| {
        app_error(
            ErrorCode::MediaReadFailed,
            format!(
                "Failed to read media link directory {}: {error}",
                directory.display()
            ),
        )
    })?;
    let mut files = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let extension = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .unwrap_or_default();
            if !extensions.is_empty() && !extensions.contains(&extension) {
                return None;
            }
            Some(MediaLinkFile {
                file_name: entry.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        left.file_name
            .to_ascii_lowercase()
            .cmp(&right.file_name.to_ascii_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(files)
}

#[tauri::command]
pub(crate) async fn list_media_link_files(
    directory: String,
    extensions: Vec<String>,
) -> CommandResult<Vec<MediaLinkFile>> {
    let directory = PathBuf::from(directory);
    let extensions = normalized_extensions(extensions);
    tokio::task::spawn_blocking(move || media_link_files_in_directory(&directory, &extensions))
        .await
        .map_err(|error| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                format!("Media link directory task failed: {error}"),
            )
        })?
}

fn media_browser_directory(directory: &Path) -> AppResult<MediaBrowserDirectory> {
    if !directory.is_dir() {
        return Err(app_error(
            ErrorCode::MediaNotFound,
            format!(
                "Media browser directory does not exist: {}",
                directory.display()
            ),
        ));
    }

    let children = fs::read_dir(directory).map_err(|error| {
        app_error(
            ErrorCode::MediaReadFailed,
            format!(
                "Failed to read media browser directory {}: {error}",
                directory.display()
            ),
        )
    })?;
    let mut entries = children
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            Some(MediaBrowserEntry {
                path: entry.path().to_string_lossy().into_owned(),
                is_directory: metadata.is_dir(),
                is_hidden: media_browser_entry_is_hidden(&name, &metadata),
                name,
                size: if metadata.is_file() {
                    metadata.len()
                } else {
                    0
                },
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.path.cmp(&right.path))
    });

    Ok(MediaBrowserDirectory {
        directory: directory.to_string_lossy().into_owned(),
        parent: directory
            .parent()
            .filter(|parent| *parent != directory)
            .map(|parent| parent.to_string_lossy().into_owned()),
        entries,
    })
}

fn media_browser_entry_is_hidden(name: &str, metadata: &fs::Metadata) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = metadata;
        false
    }
}

#[tauri::command]
pub(crate) async fn list_media_browser_directory(
    directory: String,
) -> CommandResult<MediaBrowserDirectory> {
    let directory = PathBuf::from(directory);
    tokio::task::spawn_blocking(move || media_browser_directory(&directory))
        .await
        .map_err(|error| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                format!("Media browser directory task failed: {error}"),
            )
        })?
}

#[tauri::command]
pub(crate) fn list_media_browser_roots() -> CommandResult<Vec<MediaBrowserRoot>> {
    #[cfg(target_os = "windows")]
    {
        Ok((b'A'..=b'Z')
            .filter_map(|letter| {
                let path = format!("{}:\\", letter as char);
                Path::new(&path).is_dir().then_some(MediaBrowserRoot {
                    name: format!("{}:（本地磁盘）", letter as char),
                    path,
                })
            })
            .collect())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![MediaBrowserRoot {
            path: "/".to_string(),
            name: "/".to_string(),
        }])
    }
}

#[tauri::command]
pub(crate) async fn probe_media_link_files(
    paths: Vec<String>,
    task_id: String,
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<MediaLinkFileMetadata>> {
    let task = register_task(&task_id, state.inner())?;
    let preferences = preferences_clone(&state)?;
    let mut metadata = Vec::new();

    for path in paths {
        task.check_cancelled()?;
        let probe = probe_media_with_timeout(
            Path::new(&path),
            &preferences,
            state.inner(),
            &task_id,
            task.cancel_token(),
            Duration::from_secs(15),
        )
        .await;
        let Ok(probe) = probe else {
            continue;
        };
        metadata.push(MediaLinkFileMetadata {
            path,
            duration_us: probe
                .format
                .as_ref()
                .and_then(|format| format.duration.as_deref())
                .map(parse_decimal_seconds_to_us)
                .unwrap_or(0),
            start_time_us: probe
                .format
                .as_ref()
                .and_then(|format| format.start_time.as_deref())
                .map(parse_decimal_seconds_to_us)
                .unwrap_or(0),
            tape_name: probe_tape_name(&probe),
            has_video: probe
                .streams
                .iter()
                .any(|stream| stream.codec_type.as_deref() == Some("video")),
            has_audio: probe
                .streams
                .iter()
                .any(|stream| stream.codec_type.as_deref() == Some("audio")),
        });
    }

    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_browser_lists_directories_first_and_link_scan_filters_extensions() {
        let directory = std::env::temp_dir().join(format!(
            "locution-pro-media-browser-test-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(directory.join("folder")).unwrap();
        fs::write(directory.join("clip.MP4"), b"video").unwrap();
        fs::write(directory.join("notes.txt"), b"text").unwrap();
        fs::write(directory.join(".hidden.mov"), b"video").unwrap();

        let listing = media_browser_directory(&directory).unwrap();
        assert_eq!(listing.entries[0].name, "folder");
        assert!(listing.entries[0].is_directory);
        assert!(listing
            .entries
            .iter()
            .find(|entry| entry.name == ".hidden.mov")
            .is_some_and(|entry| entry.is_hidden));

        let extensions = normalized_extensions(vec![".mp4".to_string()]);
        let files = media_link_files_in_directory(&directory, &extensions).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_name, "clip.MP4");

        fs::remove_dir_all(&directory).unwrap();
    }
}
