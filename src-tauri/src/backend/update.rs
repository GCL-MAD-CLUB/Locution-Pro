use super::*;
use std::io::Write;
use std::sync::OnceLock;

const REPOSITORY: &str = "GCL-MAD-CLUB/Locution-Pro";
const CDN: &str = "https://openlist.frameneo.com/sd/YRrdPxj2";
const MAX_MANIFEST: usize = 64 * 1024;
const MAX_INSTALLER: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LatestRelease {
    version: String,
    title: String,
    body: String,
    url: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Installer {
    signature: String,
    url: String,
    #[serde(default)]
    cdn_url: String,
}

#[derive(Deserialize)]
struct Platform {
    #[serde(flatten)]
    full: Installer,
    updater: Option<Installer>,
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
    pub_date: String,
    platforms: HashMap<String, Platform>,
    #[serde(default)]
    notes: String,
}

#[derive(Clone)]
struct PreparedUpdate {
    release: LatestRelease,
    installer: Installer,
    path: Option<PathBuf>,
}

#[derive(Clone, Serialize, Deserialize)]
struct CachedUpdate {
    release: LatestRelease,
    installer: Installer,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct UpdatePreferences {
    pending: Option<CachedUpdate>,
    ignored_versions: Vec<String>,
    seen_versions: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateFailure {
    version: String,
    error: String,
    exit_code: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStartup {
    pending: Option<LatestRelease>,
    ignored: bool,
    notes: Option<LatestRelease>,
    failure: Option<UpdateFailure>,
    ignored_versions: Vec<String>,
}

fn update_preferences<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce(&mut UpdatePreferences) -> AppResult<T>,
) -> AppResult<T> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| update_error(error.to_string()))?
        .join("update-state.json");
    update_preferences_at(&path, action)
}

fn update_preferences_at<T>(
    path: &Path,
    action: impl FnOnce(&mut UpdatePreferences) -> AppResult<T>,
) -> AppResult<T> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK
        .lock()
        .map_err(|_| update_error("Update preferences are locked"))?;
    let mut state = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<UpdatePreferences>(&bytes)
            .map_err(|error| invalid_update(format!("Read update preferences: {error}")))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => UpdatePreferences::default(),
        Err(error) => return Err(update_error(error.to_string())),
    };
    let result = action(&mut state)?;
    let bytes = serde_json::to_vec(&state).map_err(|error| update_error(error.to_string()))?;
    let parent = path
        .parent()
        .ok_or_else(|| update_error("Missing update preferences directory"))?;
    fs::create_dir_all(parent).map_err(|error| update_error(error.to_string()))?;
    let temporary = parent.join(format!("update-state-{}.tmp", Uuid::new_v4()));
    let saved = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        // rename replaces the previous file atomically, including on Windows.
        // Never remove the old state before the replacement is ready.
        fs::rename(&temporary, path)
    })();
    if let Err(error) = saved {
        let _ = fs::remove_file(&temporary);
        return Err(update_error(format!("Persist update preferences: {error}")));
    }
    Ok(result)
}

fn remember_version(versions: &mut Vec<String>, version: String) {
    if !versions.contains(&version) {
        versions.push(version);
    }
}

fn stable_version(value: &str) -> AppResult<semver::Version> {
    let version =
        semver::Version::parse(value).map_err(|error| invalid_update(error.to_string()))?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err(invalid_update("Expected a stable update version"));
    }
    Ok(version)
}

fn cached_installer_path(
    app: &tauri::AppHandle,
    version: &str,
    installer: &Installer,
) -> AppResult<PathBuf> {
    stable_version(version)?;
    validate_installer(installer, version, "update")?;
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| update_error(error.to_string()))?
        .join("updates")
        .join(format!(
            "{version}-{}",
            installer.signature.to_ascii_lowercase()
        ))
        .join("update.exe"))
}

fn launch_failure(arguments: impl IntoIterator<Item = String>) -> Option<UpdateFailure> {
    let encoded = arguments
        .into_iter()
        .find_map(|argument| argument.strip_prefix("--update-error=").map(str::to_owned))?;
    if encoded.len() > 24576 || encoded.len() % 2 != 0 || !encoded.is_ascii() {
        return None;
    }
    let bytes = (0..encoded.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&encoded[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let failure: UpdateFailure = serde_json::from_slice(&bytes).ok()?;
    stable_version(&failure.version).ok()?;
    (!failure.error.trim().is_empty()).then_some(failure)
}

#[tauri::command]
pub(crate) async fn update_startup(app: tauri::AppHandle) -> CommandResult<UpdateStartup> {
    let failure = launch_failure(env::args());
    let (cached, ignored, seen) = update_preferences(&app, |state| {
        Ok((
            state.pending.clone(),
            state.ignored_versions.clone(),
            state.seen_versions.clone(),
        ))
    })
    .unwrap_or_else(|error| {
        tracing::warn!(error = error.detail(), "Read startup update preferences");
        (None, Vec::new(), Vec::new())
    });
    let current = env!("CARGO_PKG_VERSION");
    let mut pending = None;
    let mut notes = None;
    if let Some(cached) = cached.filter(|cached| {
        stable_version(&cached.release.version).is_ok()
            && validate_installer(&cached.installer, &cached.release.version, "update").is_ok()
    }) {
        if stable_version(&cached.release.version)? > stable_version(current)? {
            let path = cached_installer_path(&app, &cached.release.version, &cached.installer)?;
            if verify_download(&path, &cached.installer.signature).is_ok() {
                updates()
                    .lock()
                    .map_err(|_| update_error("Update state is unavailable"))?
                    .insert(
                        cached.release.version.clone(),
                        PreparedUpdate {
                            release: cached.release.clone(),
                            installer: cached.installer,
                            path: Some(path),
                        },
                    );
                pending = Some(cached.release);
            }
        } else if cached.release.version == current {
            notes = Some(cached.release);
        }
    }
    if seen.iter().any(|version| version == current) {
        notes = None;
    } else {
        let mut release = notes.unwrap_or_else(|| LatestRelease {
            version: current.into(),
            title: format!("Locution Pro {current}"),
            body: String::new(),
            url: format!("https://github.com/{REPOSITORY}/releases/tag/v{current}"),
        });
        if let Ok(client) = release_client(Duration::from_secs(4)) {
            fill_release_notes(&client, &mut release).await;
        }
        notes = Some(release);
    }
    Ok(UpdateStartup {
        ignored: pending
            .as_ref()
            .is_some_and(|release| ignored.contains(&release.version)),
        pending,
        notes,
        failure,
        ignored_versions: ignored,
    })
}

#[tauri::command]
pub(crate) fn set_update_ignored(
    app: tauri::AppHandle,
    version: String,
    ignored: bool,
) -> CommandResult<()> {
    stable_version(&version)?;
    update_preferences(&app, |state| {
        state.ignored_versions.retain(|entry| entry != &version);
        if ignored {
            remember_version(&mut state.ignored_versions, version);
        }
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn acknowledge_update_notes(app: tauri::AppHandle) -> CommandResult<()> {
    update_preferences(&app, |state| {
        remember_version(&mut state.seen_versions, env!("CARGO_PKG_VERSION").into());
        Ok(())
    })
}

fn updates() -> &'static Mutex<HashMap<String, PreparedUpdate>> {
    static UPDATES: OnceLock<Mutex<HashMap<String, PreparedUpdate>>> = OnceLock::new();
    UPDATES.get_or_init(Mutex::default)
}

fn update_error(detail: impl Into<String>) -> AppError {
    app_error(ErrorCode::UpdateCheckFailed, detail)
}

fn invalid_update(detail: impl Into<String>) -> AppError {
    app_error(ErrorCode::UpdateResponseInvalid, detail)
}

fn validate_installer(installer: &Installer, version: &str, variant: &str) -> AppResult<()> {
    let name = format!("Locution.Pro_{version}_x64-{variant}.exe");
    if installer.signature.len() != 64
        || !installer
            .signature
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
        || installer.url
            != format!("https://github.com/{REPOSITORY}/releases/download/v{version}/{name}")
        || (!installer.cdn_url.is_empty() && installer.cdn_url != format!("{CDN}/{name}"))
    {
        return Err(invalid_update("Invalid immutable installer URL or SHA-256"));
    }
    Ok(())
}

fn decode_manifest(bytes: &[u8]) -> AppResult<(LatestRelease, Option<Installer>)> {
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|error| invalid_update(error.to_string()))?;
    let version = semver::Version::parse(&manifest.version)
        .map_err(|error| update_error(error.to_string()))?;
    if !version.pre.is_empty()
        || !version.build.is_empty()
        || time::OffsetDateTime::parse(
            &manifest.pub_date,
            &time::format_description::well_known::Rfc3339,
        )
        .is_err()
    {
        return Err(invalid_update(
            "Expected a stable release manifest and RFC 3339 publication date",
        ));
    }
    let platform = manifest
        .platforms
        .get("windows-x86_64")
        .ok_or_else(|| update_error("Missing Windows platform"))?;
    validate_installer(&platform.full, &manifest.version, "setup")?;
    if let Some(installer) = &platform.updater {
        validate_installer(installer, &manifest.version, "update")?;
    }
    Ok((
        LatestRelease {
            title: format!("Locution Pro {}", manifest.version),
            url: format!(
                "https://github.com/{REPOSITORY}/releases/tag/v{}",
                manifest.version
            ),
            version: manifest.version,
            body: manifest.notes,
        },
        platform.updater.clone(),
    ))
}

fn release_client(timeout: Duration) -> CommandResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(30))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 || attempt.url().scheme() != "https" {
                attempt.error("Unsafe release redirect")
            } else {
                attempt.follow()
            }
        }))
        .user_agent(concat!("Locution-Pro/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| update_error(format!("Create update client: {error}")))
}

async fn read_manifest(
    client: &reqwest::Client,
    url: &str,
) -> AppResult<(LatestRelease, Option<Installer>)> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| update_error(error.to_string()))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| update_error(error.to_string()))?
    {
        if bytes.len() + chunk.len() > MAX_MANIFEST {
            return Err(update_error("Release manifest is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    decode_manifest(&bytes)
}

async fn fill_release_notes(client: &reqwest::Client, release: &mut LatestRelease) {
    if !release.body.is_empty() {
        return;
    }
    let request = client
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/releases/tags/v{}",
            release.version
        ))
        .timeout(Duration::from_secs(3));
    let Ok(mut response) = request
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
    else {
        return;
    };
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= MAX_MANIFEST => {
                bytes.extend_from_slice(&chunk)
            }
            Ok(None) => break,
            _ => return,
        }
    }
    #[derive(Deserialize)]
    struct Notes {
        name: Option<String>,
        body: Option<String>,
    }
    if let Ok(notes) = serde_json::from_slice::<Notes>(&bytes) {
        if let Some(name) = notes.name.filter(|name| !name.trim().is_empty()) {
            release.title = name;
        }
        release.body = notes.body.unwrap_or_default();
    }
}

#[tauri::command]
pub(crate) async fn fetch_latest_release() -> CommandResult<LatestRelease> {
    let client = release_client(Duration::from_secs(8))?;
    let mut failures = Vec::new();
    for url in [
        format!("{CDN}/latest.json"),
        format!("https://github.com/{REPOSITORY}/releases/latest/download/latest.json"),
    ] {
        match read_manifest(&client, &url).await {
            Ok((mut release, installer)) => {
                let newer = semver::Version::parse(&release.version).unwrap()
                    > semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
                if newer {
                    let Some(installer) = installer else {
                        failures.push("Release has no update-only installer".into());
                        continue;
                    };
                    fill_release_notes(&client, &mut release).await;
                    {
                        let mut state = updates()
                            .lock()
                            .map_err(|_| update_error("Update state is unavailable"))?;
                        let previous = state.get(&release.version).and_then(|old| {
                            (old.installer.signature == installer.signature)
                                .then(|| old.path.clone())
                                .flatten()
                        });
                        state.insert(
                            release.version.clone(),
                            PreparedUpdate {
                                release: release.clone(),
                                installer,
                                path: previous,
                            },
                        );
                    }
                }
                return Ok(release);
            }
            Err(error) => failures.push(error.detail().to_string()),
        }
    }
    Err(update_error(format!(
        "Release manifests unavailable: {}",
        failures.join("; ")
    )))
}

fn prepared_update(version: &str) -> CommandResult<PreparedUpdate> {
    updates()
        .lock()
        .map_err(|_| update_error("Update state is unavailable"))?
        .get(version)
        .cloned()
        .ok_or_else(|| update_error("Check for updates before downloading or installing"))
}

fn verify_download(path: &Path, signature: &str) -> AppResult<()> {
    let mut file = fs::File::open(path).map_err(|error| update_error(error.to_string()))?;
    let size = file
        .metadata()
        .map_err(|error| update_error(error.to_string()))?
        .len();
    if !(2..=MAX_INSTALLER).contains(&size) {
        return Err(update_error("Invalid update installer size"));
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    let mut first = true;
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| update_error(error.to_string()))?;
        if count == 0 {
            break;
        }
        if first && !buffer[..count].starts_with(b"MZ") {
            return Err(update_error("Update is not a Windows executable"));
        }
        first = false;
        hash.update(&buffer[..count]);
    }
    if format!("{:x}", hash.finalize()) != signature.to_ascii_lowercase() {
        return Err(update_error("Update installer SHA-256 mismatch"));
    }
    Ok(())
}

async fn download_from(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    signature: &str,
) -> AppResult<()> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| update_error(error.to_string()))?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_INSTALLER)
    {
        return Err(update_error("Update is too large"));
    }
    let mut file = fs::File::create(path).map_err(|error| update_error(error.to_string()))?;
    let mut size = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| update_error(error.to_string()))?
    {
        size += chunk.len() as u64;
        if size > MAX_INSTALLER {
            return Err(update_error("Update is too large"));
        }
        file.write_all(&chunk)
            .map_err(|error| update_error(error.to_string()))?;
    }
    file.sync_all()
        .map_err(|error| update_error(error.to_string()))?;
    drop(file);
    verify_download(path, signature)
}

async fn download_installer(
    client: &reqwest::Client,
    installer: &Installer,
    path: &Path,
) -> AppResult<()> {
    let mut failures = Vec::new();
    for url in [&installer.cdn_url, &installer.url] {
        if url.is_empty() {
            continue;
        }
        match download_from(client, url, path, &installer.signature).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                failures.push(error.detail().to_string());
                let _ = fs::remove_file(path);
            }
        }
    }
    Err(update_error(format!(
        "Update download failed: {}",
        failures.join("; ")
    )))
}

#[tauri::command]
pub(crate) async fn download_update(app: tauri::AppHandle, version: String) -> CommandResult<()> {
    let prepared = prepared_update(&version)?;
    if prepared
        .path
        .as_ref()
        .is_some_and(|path| verify_download(path, &prepared.installer.signature).is_ok())
    {
        persist_download(&app, &prepared)?;
        return Ok(());
    }
    let path = cached_installer_path(&app, &version, &prepared.installer)?;
    let directory = path
        .parent()
        .ok_or_else(|| update_error("Missing update cache directory"))?;
    fs::create_dir_all(directory).map_err(|error| update_error(error.to_string()))?;
    if path.is_file() && verify_download(&path, &prepared.installer.signature).is_ok() {
        updates()
            .lock()
            .map_err(|_| update_error("Update state is unavailable"))?
            .get_mut(&version)
            .ok_or_else(|| update_error("Update metadata changed"))?
            .path = Some(path);
        persist_download(&app, &prepared)?;
        return Ok(());
    }
    let partial = directory.join(format!("{}.part", Uuid::new_v4()));
    let client = release_client(Duration::from_secs(180))?;
    download_installer(&client, &prepared.installer, &partial).await?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| update_error(error.to_string()))?;
    }
    fs::rename(&partial, &path).map_err(|error| update_error(error.to_string()))?;
    let mut state = updates()
        .lock()
        .map_err(|_| update_error("Update state is unavailable"))?;
    let current = state
        .get_mut(&version)
        .ok_or_else(|| update_error("Update metadata changed"))?;
    if current.installer.signature != prepared.installer.signature {
        return Err(invalid_update("Release metadata changed while downloading"));
    }
    current.path = Some(path);
    drop(state);
    persist_download(&app, &prepared)?;
    Ok(())
}

fn persist_download(app: &tauri::AppHandle, prepared: &PreparedUpdate) -> AppResult<()> {
    update_preferences(app, |state| {
        if state.pending.as_ref().is_some_and(|cached| {
            matches!((stable_version(&cached.release.version), stable_version(&prepared.release.version)),
                (Ok(cached), Ok(incoming)) if cached > incoming)
        }) {
            return Ok(());
        }
        state.pending = Some(CachedUpdate {
            release: prepared.release.clone(),
            installer: prepared.installer.clone(),
        });
        Ok(())
    })
}

#[tauri::command]
pub(crate) async fn install_update(
    version: String,
    project_path: Option<String>,
) -> CommandResult<()> {
    let prepared = prepared_update(&version)?;
    let installer = prepared
        .path
        .ok_or_else(|| update_error("The update has not finished downloading"))?;
    #[cfg(not(windows))]
    {
        let _ = (installer, project_path);
        Err(update_error(
            "Windows updates are unavailable on this platform",
        ))
    }
    #[cfg(windows)]
    {
        let signature = prepared.installer.signature;
        let (mut child, ready) = tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
            verify_download(&installer, &signature)?;
            let executable = env::current_exe().map_err(|error| update_error(error.to_string()))?;
            let root = executable
                .parent()
                .ok_or_else(|| update_error("Missing installation directory"))?;
            let directory = installer
                .parent()
                .ok_or_else(|| update_error("Missing update directory"))?
                .join(format!("handoff-{}", Uuid::new_v4()));
            fs::create_dir(&directory).map_err(|error| update_error(error.to_string()))?;
            let data = directory.join("handoff.json");
            let handoff = serde_json::json!({
                "parent": std::process::id(), "executable": executable, "installer": installer,
                "signature": signature, "project": project_path, "version": version,
                    "requireAcceptance": true,
            });
            let bytes =
                serde_json::to_vec(&handoff).map_err(|error| update_error(error.to_string()))?;
            fs::write(&data, bytes).map_err(|error| update_error(error.to_string()))?;
            // The updater owns shutdown. Keep the application alive until it has
            // verified the handoff and can display its progress window.
            let child = StdCommand::new(&installer)
                .arg("/UPDATE")
                // NSIS parses /KEY="value", not a quoted whole option.
                .raw_arg(format!("/HANDOFF=\"{}\"", data.display()))
                .raw_arg(format!("/D={}", root.display()))
                .spawn()
                .map_err(|error| update_error(error.to_string()))?;
            Ok((child, directory.join("ready")))
        })
        .await
        .map_err(|error| update_error(error.to_string()))??;
        for _ in 0..600 {
            if ready.is_file() {
                let accepted = ready.with_file_name("accepted");
                fs::write(accepted, b"accepted")
                    .map_err(|error| update_error(error.to_string()))?;
                return Ok(());
            }
            if child
                .try_wait()
                .map_err(|error| update_error(error.to_string()))?
                .is_some()
            {
                return Err(update_error(
                    "The updater closed before accepting the handoff",
                ));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        // Revoke the handoff before restoring editing. A delayed controller
        // cannot kill this process without the explicit acceptance above.
        let _ = fs::write(ready.with_file_name("cancel-start"), b"cancel");
        Err(update_error("The updater has not acknowledged startup"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_survive_relaunch_without_resetting_ignored_or_seen_versions() {
        let directory = env::temp_dir().join(format!("locution-update-{}", Uuid::new_v4()));
        let path = directory.join("update-state.json");
        let (release, installer) =
            decode_manifest(&serde_json::to_vec(&manifest()).unwrap()).unwrap();
        update_preferences_at(&path, |state| {
            state.pending = Some(CachedUpdate {
                release,
                installer: installer.unwrap(),
            });
            remember_version(&mut state.ignored_versions, "1.2.3".into());
            remember_version(&mut state.seen_versions, "0.4.1".into());
            Ok(())
        })
        .unwrap();
        update_preferences_at(&path, |state| {
            assert_eq!(state.pending.as_ref().unwrap().release.version, "1.2.3");
            assert_eq!(state.ignored_versions, ["1.2.3"]);
            assert_eq!(state.seen_versions, ["0.4.1"]);
            remember_version(&mut state.seen_versions, "0.4.1".into());
            remember_version(&mut state.seen_versions, "1.2.3".into());
            state.ignored_versions.clear();
            Ok(())
        })
        .unwrap();
        let before = fs::read(&path).unwrap();
        assert!(update_preferences_at(&path, |state| {
            state.pending = None;
            Err::<(), _>(update_error("Simulated preference failure"))
        })
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let state: UpdatePreferences = serde_json::from_slice(&before).unwrap();
        assert_eq!(state.seen_versions, ["0.4.1", "1.2.3"]);
        assert!(state.ignored_versions.is_empty());
        fs::remove_file(path).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn failure_arguments_round_trip_unicode_and_reject_invalid_or_oversized_payloads() {
        let payload = serde_json::json!({"version": "1.2.3", "exitCode": 2, "error": "Hash mismatch: D:\\应用\\runtime.dll\nRollback completed."});
        let encoded = serde_json::to_vec(&payload)
            .unwrap()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let failure =
            launch_failure(["app.exe".into(), format!("--update-error={encoded}")]).unwrap();
        assert_eq!(failure.error, payload["error"].as_str().unwrap());
        assert_eq!(failure.exit_code, 2);
        for invalid in [
            "z1".to_string(),
            "0".into(),
            "应用".into(),
            "00".repeat(12289),
        ] {
            assert!(launch_failure([format!("--update-error={invalid}")]).is_none());
        }
    }

    fn manifest() -> serde_json::Value {
        let artifact = |kind| {
            serde_json::json!({
                "signature": "a".repeat(64),
                "url": format!("https://github.com/{REPOSITORY}/releases/download/v1.2.3/Locution.Pro_1.2.3_x64-{kind}.exe"),
                "cdn_url": format!("{CDN}/Locution.Pro_1.2.3_x64-{kind}.exe"),
            })
        };
        let mut platform = artifact("setup");
        platform["updater"] = artifact("update");
        serde_json::json!({ "version": "1.2.3", "pub_date": "2026-10-05T16:40:45Z", "platforms": { "windows-x86_64": platform } })
    }

    #[test]
    fn manifest_requires_the_dedicated_update_executable_and_digest() {
        let mut data = manifest();
        let (release, updater) = decode_manifest(&serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(release.version, "1.2.3");
        assert!(updater.unwrap().url.ends_with("-update.exe"));
        for invalid in [
            "https://example.com/update.exe",
            "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/latest/download/update.exe",
        ] {
            data["platforms"]["windows-x86_64"]["updater"]["url"] = invalid.into();
            assert!(decode_manifest(&serde_json::to_vec(&data).unwrap()).is_err());
        }
    }

    #[test]
    fn legacy_manifest_can_report_the_current_version_without_an_updater() {
        let mut data = manifest();
        data["platforms"]["windows-x86_64"]
            .as_object_mut()
            .unwrap()
            .remove("updater");
        assert!(decode_manifest(&serde_json::to_vec(&data).unwrap())
            .unwrap()
            .1
            .is_none());
        data["version"] = "../1.2.3".into();
        assert!(decode_manifest(&serde_json::to_vec(&data).unwrap()).is_err());
    }

    #[test]
    fn downloaded_executable_requires_matching_bytes_and_a_windows_header() {
        let path = env::temp_dir().join(format!("locution-update-{}.exe", Uuid::new_v4()));
        let bytes = b"MZ update fixture";
        fs::write(&path, bytes).unwrap();
        let signature = format!("{:x}", Sha256::digest(bytes));
        assert!(verify_download(&path, &signature).is_ok());
        assert!(verify_download(&path, &"0".repeat(64)).is_err());
        fs::write(&path, b"<html>error</html>").unwrap();
        assert!(verify_download(&path, &signature).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn a_corrupt_cdn_download_falls_back_to_github_without_mixing_bytes() {
        use std::net::TcpListener;
        use std::thread;
        use std::time::Instant;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            let deadline = Instant::now() + Duration::from_secs(10);
            for body in [
                b"MZ corrupt CDN bytes".as_slice(),
                b"MZ verified GitHub installer".as_slice(),
            ] {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("Update fixture connection failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0; 4096];
                let count = stream.read(&mut request).unwrap();
                requests.push(
                    String::from_utf8_lossy(&request[..count])
                        .lines()
                        .next()
                        .unwrap()
                        .to_string(),
                );
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                stream.write_all(body).unwrap();
            }
            requests
        });
        let path =
            env::temp_dir().join(format!("locution-update-fallback-{}.part", Uuid::new_v4()));
        let expected = b"MZ verified GitHub installer";
        let installer = Installer {
            signature: format!("{:x}", Sha256::digest(expected)),
            cdn_url: format!("http://{address}/cdn"),
            url: format!("http://{address}/github"),
        };
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                download_installer(
                    &release_client(Duration::from_secs(3)).unwrap(),
                    &installer,
                    &path,
                )
                .await
                .unwrap();
            });
        assert_eq!(fs::read(&path).unwrap(), expected);
        fs::remove_file(path).unwrap();
        assert_eq!(
            server.join().unwrap(),
            ["GET /cdn HTTP/1.1", "GET /github HTTP/1.1"]
        );
    }
}
