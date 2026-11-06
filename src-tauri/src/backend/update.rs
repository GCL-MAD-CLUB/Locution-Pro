use super::*;
use std::io::Write;
use std::sync::OnceLock;

const REPOSITORY: &str = "GCL-MAD-CLUB/Locution-Pro";
const CDN: &str = "https://openlist.frameneo.com/sd/YRrdPxj2";
const MAX_MANIFEST: usize = 64 * 1024;
const MAX_RELEASE: usize = 1024 * 1024;
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
    if stable_version(env!("CARGO_PKG_VERSION")).is_err() {
        return Ok(UpdateStartup {
            pending: None,
            notes: None,
            failure: None,
            ignored: false,
            ignored_versions: Vec::new(),
        });
    }
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

fn decode_github_release(bytes: &[u8]) -> AppResult<LatestRelease> {
    #[derive(Deserialize)]
    struct GitHubRelease {
        tag_name: String,
        name: Option<String>,
        body: Option<String>,
        html_url: String,
        #[serde(default)]
        draft: bool,
        #[serde(default)]
        prerelease: bool,
    }
    let release: GitHubRelease =
        serde_json::from_slice(bytes).map_err(|error| invalid_update(error.to_string()))?;
    let version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    if release.draft
        || release.prerelease
        || semver::Version::parse(version).is_ok_and(|version| !version.pre.is_empty())
    {
        return Err(update_error("Ignored prerelease"));
    }
    stable_version(version)?;
    if release.draft
        || release.prerelease
        || release.html_url
            != format!(
                "https://github.com/{REPOSITORY}/releases/tag/{}",
                release.tag_name
            )
    {
        return Err(invalid_update(
            "Expected a public stable release in the application repository",
        ));
    }
    Ok(LatestRelease {
        version: version.into(),
        title: release.name.unwrap_or_default(),
        body: release.body.unwrap_or_default(),
        url: release.html_url,
    })
}

async fn read_github_release(client: &reqwest::Client, url: &str) -> AppResult<LatestRelease> {
    let mut response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
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
        if bytes.len() + chunk.len() > MAX_RELEASE {
            return Err(invalid_update("GitHub release response is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    decode_github_release(&bytes)
}

// The manifest enables automatic installation; it is not required to discover
// a release. Keep usable release metadata even if every automatic path fails.
async fn discover_release(
    client: &reqwest::Client,
    manifests: [&str; 2],
    github: &str,
) -> AppResult<(LatestRelease, Option<Installer>)> {
    let mut failures = Vec::new();
    let mut ignored = false;
    let mut best: Option<(LatestRelease, Option<Installer>)> = None;
    // CDN metadata is a discovery hint only. Only GitHub may authorize bytes.
    for (index, url) in manifests.into_iter().enumerate() {
        match read_manifest(client, url).await {
            Ok((release, installer)) => {
                let installer = if index == 1 { installer } else { None };
                select_release(&mut best, release, installer)?;
            }
            Err(error) => {
                ignored |= error.detail() == "Ignored prerelease";
                failures.push(error.detail().to_string());
            }
        }
    }
    match read_github_release(client, github).await {
        Ok(release) => select_release(&mut best, release, None)?,
        Err(error) => {
            ignored |= error.detail() == "Ignored prerelease";
            failures.push(error.detail().to_string());
        }
    }
    if best.is_none() && ignored {
        return Ok((
            LatestRelease {
                version: env!("CARGO_PKG_VERSION").into(),
                title: String::new(),
                body: String::new(),
                url: String::new(),
            },
            None,
        ));
    }
    best.ok_or_else(|| {
        update_error(format!(
            "All release sources unavailable: {}",
            failures.join("; ")
        ))
    })
}

fn select_release(
    best: &mut Option<(LatestRelease, Option<Installer>)>,
    release: LatestRelease,
    installer: Option<Installer>,
) -> AppResult<()> {
    let version = stable_version(&release.version)?;
    if let Some((known, updater)) = best {
        let previous = stable_version(&known.version)?;
        if version < previous {
            return Ok(());
        }
        if version == previous {
            if installer.is_some() {
                *updater = installer;
            }
            if !release.body.trim().is_empty() {
                known.body = release.body;
            }
            if !release.title.trim().is_empty() {
                known.title = release.title;
            }
            return Ok(());
        }
    }
    *best = Some((release, installer));
    Ok(())
}

async fn authoritative_installer(client: &reqwest::Client, version: &str) -> AppResult<Installer> {
    stable_version(version)?;
    let published = read_github_release(
        client,
        &format!("https://api.github.com/repos/{REPOSITORY}/releases/tags/v{version}"),
    )
    .await?;
    if published.version != version {
        return Err(invalid_update("GitHub release version mismatch"));
    }
    let (release, installer) = read_manifest(
        client,
        &format!("https://github.com/{REPOSITORY}/releases/download/v{version}/latest.json"),
    )
    .await?;
    if release.version != version {
        return Err(invalid_update("GitHub manifest version mismatch"));
    }
    installer.ok_or_else(|| invalid_update("GitHub release has no update-only installer"))
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
    let current = match stable_version(env!("CARGO_PKG_VERSION")) {
        Ok(current) => current,
        Err(_) => {
            return Ok(LatestRelease {
                version: env!("CARGO_PKG_VERSION").into(),
                title: String::new(),
                body: String::new(),
                url: String::new(),
            })
        }
    };
    let client = release_client(Duration::from_secs(8))?;
    let (mut release, installer) = discover_release(
        &client,
        [
            &format!("{CDN}/latest.json"),
            &format!("https://github.com/{REPOSITORY}/releases/latest/download/latest.json"),
        ],
        &format!("https://api.github.com/repos/{REPOSITORY}/releases/latest"),
    )
    .await?;
    fill_release_notes(&client, &mut release).await;
    let newer = stable_version(&release.version)? > current;
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
    // A path in memory has already been hashed during this session. The final
    // installation boundary always checks bytes again against GitHub authority.
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
        let client = release_client(Duration::from_secs(8))?;
        let authority = authoritative_installer(&client, &version).await?;
        if authority.signature != prepared.installer.signature {
            return Err(invalid_update(
                "Cached update does not match the GitHub release SHA-256",
            ));
        }
        let signature = authority.signature;
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

    fn github_release() -> serde_json::Value {
        serde_json::json!({
            "tag_name": "v1.2.3", "name": "Release without latest.json", "body": "Legacy notes",
            "html_url": format!("https://github.com/{REPOSITORY}/releases/tag/v1.2.3")
        })
    }

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
            Some(&pending.join("update.exe")),
            std::time::SystemTime::now() + Duration::from_secs(32 * 86400),
        );
        assert!(!obsolete.exists());
        assert!(pending.exists());
        assert!(unrelated.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_cdn_never_hides_a_newer_github_release() {
        let newer_manifest = manifest().to_string().replace("1.2.3", "1.3.0");
        let newer_release = github_release().to_string().replace("1.2.3", "1.3.0");
        let (release, installer) = discover_fixture(vec![
            (200, manifest().to_string()),
            (200, newer_manifest),
            (200, newer_release),
        ])
        .unwrap();
        assert_eq!(release.version, "1.3.0");
        assert!(installer.is_some());
    }

    #[test]
    fn cdn_cannot_authorize_update_bytes_without_independent_github_metadata() {
        let mut cdn = manifest();
        cdn["platforms"]["windows-x86_64"]["updater"]["signature"] = "b".repeat(64).into();
        let (_, installer) = discover_fixture(vec![
            (200, cdn.to_string()),
            (200, manifest().to_string()),
            (200, github_release().to_string()),
        ])
        .unwrap();
        assert_eq!(installer.unwrap().signature, "a".repeat(64));
        let (_, installer) = discover_fixture(vec![
            (200, cdn.to_string()),
            (404, String::new()),
            (503, String::new()),
        ])
        .unwrap();
        assert!(installer.is_none());
    }

    #[test]
    fn prereleases_are_ignored_even_if_they_are_the_only_reachable_entries() {
        let preview = manifest().to_string().replace("1.2.3", "999.0.0-preview");
        let preview_api = github_release()
            .to_string()
            .replace("1.2.3", "999.0.0-preview");
        let (release, installer) = discover_fixture(vec![
            (200, preview.clone()),
            (200, preview),
            (200, preview_api),
        ])
        .unwrap();
        assert_eq!(release.version, env!("CARGO_PKG_VERSION"));
        assert!(installer.is_none());
        assert!(stable_version("0.4.1-preview").is_err());
    }

    fn discover_fixture(
        responses: Vec<(u16, String)>,
    ) -> AppResult<(LatestRelease, Option<Installer>)> {
        use std::net::TcpListener;
        use std::thread;
        use std::time::Instant;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            for (index, (status, body)) in responses.into_iter().enumerate() {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("Release fixture connection failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0; 4096];
                let count = stream.read(&mut request).unwrap();
                assert!(String::from_utf8_lossy(&request[..count])
                    .starts_with(&format!("GET /{index} ")));
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                discover_release(
                    &release_client(Duration::from_secs(3)).unwrap(),
                    [
                        &format!("http://{address}/0"),
                        &format!("http://{address}/1"),
                    ],
                    &format!("http://{address}/2"),
                )
                .await
            });
        server.join().unwrap();
        result
    }

    #[test]
    fn missing_or_invalid_manifests_fall_back_to_original_github_release_discovery() {
        for first in [
            (404, String::new()),
            (200, "<html>not a manifest</html>".into()),
        ] {
            let (release, installer) = discover_fixture(vec![
                first,
                (404, String::new()),
                (200, github_release().to_string()),
            ])
            .unwrap();
            assert_eq!(release.version, "1.2.3");
            assert_eq!(release.body, "Legacy notes");
            assert!(installer.is_none());
        }
    }

    #[test]
    fn missing_updater_preserves_known_release_even_when_the_api_is_unavailable() {
        let mut manifest = manifest();
        manifest["platforms"]["windows-x86_64"]
            .as_object_mut()
            .unwrap()
            .remove("updater");
        let (release, installer) = discover_fixture(vec![
            (200, manifest.to_string()),
            (404, String::new()),
            (403, String::new()),
        ])
        .unwrap();
        assert_eq!(release.version, "1.2.3");
        assert!(installer.is_none());
    }

    #[test]
    fn github_manifest_recovers_auto_updates_after_cdn_failure() {
        let (_, installer) =
            discover_fixture(vec![(503, String::new()), (200, manifest().to_string())]).unwrap();
        assert!(installer.is_some());
    }

    #[test]
    fn check_fails_only_when_all_release_sources_are_unusable() {
        assert!(discover_fixture(vec![
            (404, String::new()),
            (200, "{}".into()),
            (503, String::new())
        ])
        .is_err());
        let mut value = github_release();
        for field in ["draft", "prerelease"] {
            value[field] = true.into();
            assert!(decode_github_release(&serde_json::to_vec(&value).unwrap()).is_err());
            value[field] = false.into();
        }
        value["html_url"] = "https://example.com/untrusted".into();
        assert!(decode_github_release(&serde_json::to_vec(&value).unwrap()).is_err());
        value = github_release();
        value["tag_name"] = "latest".into();
        assert!(decode_github_release(&serde_json::to_vec(&value).unwrap()).is_err());
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
