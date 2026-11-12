use super::*;
use std::io::Write;
use std::sync::OnceLock;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod macos;

const REPOSITORY: &str = "GCL-MAD-CLUB/Locution-Pro";
const CDN: &str = "https://openlist.frameneo.com/sd/YRrdPxj2";
const MAX_MANIFEST: usize = 64 * 1024;
const MAX_INSTALLER: u64 = 256 * 1024 * 1024;

/// The latest.json platform entry this build installs from and its immutable
/// asset names. macOS replaces the application bundle from a gzip archive;
/// Windows runs the update-only NSIS installer.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod release_platform {
    pub(super) const KEY: &str = "darwin-aarch64";
    pub(super) const UPDATE_HEADER: &[u8] = &[0x1f, 0x8b];
    pub(super) const UPDATE_FILE: &str = "update.tar.gz";

    pub(super) fn asset(version: &str, variant: &str) -> String {
        if variant == "setup" {
            format!("Locution.Pro_{version}_aarch64.dmg")
        } else {
            format!("Locution.Pro_{version}_aarch64-{variant}.tar.gz")
        }
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
mod release_platform {
    pub(super) const KEY: &str = "windows-x86_64";
    pub(super) const UPDATE_HEADER: &[u8] = b"MZ";
    pub(super) const UPDATE_FILE: &str = "update.exe";

    pub(super) fn asset(version: &str, variant: &str) -> String {
        format!("Locution.Pro_{version}_x64-{variant}.exe")
    }
}

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

fn newer_version(candidate: &str, current: &str) -> AppResult<bool> {
    let candidate =
        semver::Version::parse(candidate).map_err(|error| invalid_update(error.to_string()))?;
    let current =
        semver::Version::parse(current).map_err(|error| invalid_update(error.to_string()))?;
    // Preview builds receive the same stable releases. Build metadata and
    // publication dates do not affect SemVer precedence.
    Ok(candidate.cmp_precedence(&current).is_gt())
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
        .join(release_platform::UPDATE_FILE))
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
    let mut startup = tauri::async_runtime::spawn_blocking(move || startup_state(app))
        .await
        .map_err(|error| update_error(error.to_string()))??;
    if let Some(release) = &mut startup.notes {
        if let Ok(client) = release_client(Duration::from_secs(4)) {
            fill_release_notes(&client, release).await;
        }
    }
    Ok(startup)
}

fn startup_state(app: tauri::AppHandle) -> CommandResult<UpdateStartup> {
    let failure = launch_failure(env::args_os().filter_map(|value| value.into_string().ok()));
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
        if newer_version(&cached.release.version, current)? {
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
    if stable_version(current).is_err() || seen.iter().any(|version| version == current) {
        notes = None;
    } else {
        let release = notes.unwrap_or_else(|| LatestRelease {
            version: current.into(),
            title: format!("Locution Pro {current}"),
            body: String::new(),
            url: format!("https://github.com/{REPOSITORY}/releases/tag/v{current}"),
        });
        notes = Some(release);
    }
    if let Ok(cache) = app.path().app_cache_dir() {
        let retained = pending
            .as_ref()
            .and_then(|release| prepared_update(&release.version).ok())
            .and_then(|prepared| prepared.path);
        prune_update_cache(
            &cache.join("updates"),
            retained.as_deref(),
            std::time::SystemTime::now(),
        );
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

fn prune_update_cache(root: &Path, retained: Option<&Path>, now: std::time::SystemTime) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                continue;
            }
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((version, digest)) = name.split_once('-') else {
            continue;
        };
        if stable_version(version).is_err()
            || digest.len() != 64
            || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            continue;
        }
        let old = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > Duration::from_secs(30 * 86400));
        if old && !retained.is_some_and(|installer| installer.starts_with(&path)) {
            if let Err(error) = fs::remove_dir_all(&path) {
                tracing::warn!(%error, "Prune old update cache");
            }
        }
    }
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
    let name = release_platform::asset(version, variant);
    if installer.signature.len() != 64
        || !installer
            .signature
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
        || installer.cdn_url != format!("{CDN}/{name}")
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
    if !version.pre.is_empty() {
        return Err(update_error("Ignored prerelease"));
    }
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
        .get(release_platform::KEY)
        .ok_or_else(|| update_error(format!("Missing {} platform", release_platform::KEY)))?;
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

#[cfg(any(windows, all(target_os = "macos", target_arch = "aarch64")))]
async fn authoritative_installer(client: &reqwest::Client, version: &str) -> AppResult<Installer> {
    stable_version(version)?;
    let (release, installer) = read_manifest(client, &format!("{CDN}/latest.json")).await?;
    if release.version != version {
        return Err(invalid_update(
            "CDN release changed; check for updates again",
        ));
    }
    installer.ok_or_else(|| invalid_update("CDN release has no update-only installer"))
}

async fn fill_release_notes(client: &reqwest::Client, release: &mut LatestRelease) {
    if !release.body.is_empty() {
        return;
    }
    if let Ok((published, _)) = read_manifest(client, &format!("{CDN}/latest.json")).await {
        if published.version == release.version {
            release.body = published.body;
        }
    }
}

#[tauri::command]
pub(crate) async fn fetch_latest_release() -> CommandResult<LatestRelease> {
    let client = release_client(Duration::from_secs(8))?;
    let (release, installer) = match read_manifest(&client, &format!("{CDN}/latest.json")).await {
        Ok(release) => release,
        Err(error) if error.detail() == "Ignored prerelease" => {
            return Ok(LatestRelease {
                version: env!("CARGO_PKG_VERSION").into(),
                title: String::new(),
                body: String::new(),
                url: String::new(),
            });
        }
        Err(error) => return Err(error),
    };
    let newer = newer_version(&release.version, env!("CARGO_PKG_VERSION"))?;
    if let Some(installer) = installer.filter(|_| newer) {
        // An unavailable auto-update cache must not hide a discovered release.
        if let Ok(mut state) = updates().lock() {
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
    Ok(release)
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
        if first && !buffer[..count].starts_with(release_platform::UPDATE_HEADER) {
            return Err(update_error("Update has an unexpected file header"));
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
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|error| update_error(error.to_string()))?;
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
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|error| update_error(error.to_string()))?;
    }
    file.sync_all()
        .await
        .map_err(|error| update_error(error.to_string()))?;
    drop(file);
    let path = path.to_owned();
    let signature = signature.to_owned();
    tauri::async_runtime::spawn_blocking(move || verify_download(&path, &signature))
        .await
        .map_err(|error| update_error(error.to_string()))?
}

async fn download_installer(
    client: &reqwest::Client,
    installer: &Installer,
    path: &Path,
) -> AppResult<()> {
    let result = download_from(client, &installer.cdn_url, path, &installer.signature).await;
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

#[tauri::command]
pub(crate) async fn download_update(app: tauri::AppHandle, version: String) -> CommandResult<()> {
    let prepared = prepared_update(&version)?;
    // A path in memory has already been hashed during this session. The final
    // installation boundary always checks bytes again against the CDN manifest.
    if prepared.path.is_some() {
        return Ok(());
    }
    let app_copy = app.clone();
    let prepared_copy = prepared.clone();
    let (path, reused) = tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
        let path = cached_installer_path(
            &app_copy,
            &prepared_copy.release.version,
            &prepared_copy.installer,
        )?;
        fs::create_dir_all(
            path.parent()
                .ok_or_else(|| update_error("Missing cache directory"))?,
        )
        .map_err(|error| update_error(error.to_string()))?;
        let reused = verify_download(&path, &prepared_copy.installer.signature).is_ok();
        Ok((path, reused))
    })
    .await
    .map_err(|error| update_error(error.to_string()))??;
    let partial = path.with_file_name(format!("{}.part", Uuid::new_v4()));
    if !reused {
        let client = release_client(Duration::from_secs(180))?;
        download_installer(&client, &prepared.installer, &partial).await?;
    }
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        if !reused {
            fs::rename(&partial, &path).map_err(|error| update_error(error.to_string()))?;
        }
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
        persist_download(&app, &prepared)
    })
    .await
    .map_err(|error| update_error(error.to_string()))?
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
    app: tauri::AppHandle,
    version: String,
    project_path: Option<String>,
) -> CommandResult<()> {
    let prepared = prepared_update(&version)?;
    let installer = prepared
        .path
        .ok_or_else(|| update_error("The update has not finished downloading"))?;
    #[cfg(not(any(windows, all(target_os = "macos", target_arch = "aarch64"))))]
    {
        let _ = (app, installer, project_path);
        Err(update_error("Updates are unavailable on this platform"))
    }
    #[cfg(any(windows, all(target_os = "macos", target_arch = "aarch64")))]
    let signature = {
        let client = release_client(Duration::from_secs(8))?;
        let authority = authoritative_installer(&client, &version).await?;
        if authority.signature != prepared.installer.signature {
            return Err(invalid_update(
                "Cached update does not match the CDN release SHA-256",
            ));
        }
        authority.signature
    };
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            verify_download(&installer, &signature)?;
            macos::install(&installer, &version, project_path.as_deref())
        })
        .await
        .map_err(|error| update_error(error.to_string()))??;
        // The relaunch helper waits for this process to exit before opening
        // the updated bundle with the saved project.
        app.exit(0);
        Ok(())
    }
    #[cfg(windows)]
    {
        let _ = &app;
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
        let mut accepted = false;
        for _ in 0..600 {
            if !accepted && ready.is_file() {
                let acceptance = ready.with_file_name("accepted");
                fs::write(acceptance, b"accepted")
                    .map_err(|error| update_error(error.to_string()))?;
                accepted = true;
                // Success terminates this process. If it remains alive, keep
                // watching the controller and revoke a stalled handoff below.
            }
            if child
                .try_wait()
                .map_err(|error| update_error(error.to_string()))?
                .is_some()
            {
                return Err(update_error(
                    "The updater exited without closing the application; use the full installer",
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
    fn cache_pruning_retains_pending_updates_and_unrecognized_directories() {
        let root = env::temp_dir().join(format!("locution-cache-prune-{}", Uuid::new_v4()));
        let obsolete = root.join(format!("1.0.0-{}", "a".repeat(64)));
        let pending = root.join(format!("1.1.0-{}", "b".repeat(64)));
        let unrelated = root.join("user-files");
        for directory in [&obsolete, &pending, &unrelated] {
            fs::create_dir_all(directory).unwrap();
        }
        prune_update_cache(
            &root,
            Some(&pending.join(release_platform::UPDATE_FILE)),
            std::time::SystemTime::now() + Duration::from_secs(32 * 86400),
        );
        assert!(!obsolete.exists());
        assert!(pending.exists());
        assert!(unrelated.exists());
        fs::remove_dir_all(root).unwrap();
    }

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
            let name = release_platform::asset("1.2.3", kind);
            serde_json::json!({
                "signature": "a".repeat(64),
                "url": format!("https://github.com/{REPOSITORY}/releases/download/v1.2.3/{name}"),
                "cdn_url": format!("{CDN}/{name}"),
            })
        };
        let mut platform = artifact("setup");
        platform["updater"] = artifact("update");
        serde_json::json!({ "version": "1.2.3", "pub_date": "2026-10-05T16:40:45Z", "platforms": { release_platform::KEY: platform } })
    }

    #[test]
    fn manifest_requires_the_dedicated_update_executable_and_digest() {
        let mut data = manifest();
        let (release, updater) = decode_manifest(&serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(release.version, "1.2.3");
        assert!(updater
            .unwrap()
            .cdn_url
            .ends_with(&release_platform::asset("1.2.3", "update")));
        for invalid in [
            "https://example.com/update.exe",
            "https://github.com/GCL-MAD-CLUB/Locution-Pro/releases/latest/download/update.exe",
        ] {
            data["platforms"][release_platform::KEY]["updater"]["cdn_url"] = invalid.into();
            assert!(decode_manifest(&serde_json::to_vec(&data).unwrap()).is_err());
        }
    }

    #[test]
    fn legacy_manifest_can_report_the_current_version_without_an_updater() {
        let mut data = manifest();
        data["platforms"][release_platform::KEY]
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
    fn downloaded_update_requires_matching_bytes_and_the_platform_header() {
        let path = env::temp_dir().join(format!("locution-update-{}", Uuid::new_v4()));
        let bytes = [release_platform::UPDATE_HEADER, b" update fixture"].concat();
        fs::write(&path, &bytes).unwrap();
        let signature = format!("{:x}", Sha256::digest(&bytes));
        assert!(verify_download(&path, &signature).is_ok());
        assert!(verify_download(&path, &"0".repeat(64)).is_err());
        fs::write(&path, b"<html>error</html>").unwrap();
        assert!(verify_download(&path, &signature).is_err());
        fs::remove_file(path).unwrap();
    }
}
