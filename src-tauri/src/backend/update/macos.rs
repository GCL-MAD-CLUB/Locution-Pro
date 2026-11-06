//! Replaces the application bundle from a verified update archive.
//!
//! The archive holds `Locution Pro.app` without its large reusable files, plus
//! `update-reuse.json` listing them with the target bundle's sizes and SHA-256.
//! Each is cloned from the running bundle only when it matches, and
//! `codesign --verify` then checks the assembled bundle against its own seal.
//! The bundle is swapped by renaming within one directory and restored if the
//! swap fails; nothing outside the staging directory changes before that.
use super::*;

const BUNDLE_NAME: &str = "Locution Pro.app";
const REUSE_MANIFEST: &str = "update-reuse.json";
const BUNDLE_IDENTIFIER: &str = "com.locutionpro.desktop";

#[derive(Deserialize)]
struct ReuseManifest {
    version: String,
    files: Vec<ReusedFile>,
}

#[derive(Deserialize)]
struct ReusedFile {
    path: String,
    size: u64,
    sha256: String,
}

/// Install the verified archive over the running bundle, then relaunch it with
/// the saved project once this process has exited.
pub(super) fn install(archive: &Path, version: &str, project: Option<&str>) -> AppResult<()> {
    let bundle = current_bundle()?;
    replace_bundle(archive, version, &bundle)?;
    relaunch(&bundle, project)
}

fn replace_bundle(archive: &Path, version: &str, bundle: &Path) -> AppResult<()> {
    let parent = bundle
        .parent()
        .ok_or_else(|| update_error("Missing application directory"))?;
    let staging = parent.join(format!(".locution-pro-update-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|error| {
        update_error(format!(
            "Cannot write next to {}: {error}",
            bundle.display()
        ))
    })?;
    let result = stage(archive, version, bundle, &staging).and_then(|staged| swap(&staged, bundle));
    if let Err(error) = fs::remove_dir_all(&staging) {
        tracing::warn!(%error, "Remove update staging directory");
    }
    result
}

fn current_bundle() -> AppResult<PathBuf> {
    let executable = env::current_exe().map_err(|error| update_error(error.to_string()))?;
    let bundle = executable
        .ancestors()
        .nth(3)
        .filter(|bundle| {
            bundle
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .filter(|bundle| executable.starts_with(bundle.join("Contents").join("MacOS")))
        .ok_or_else(|| update_error("Locution Pro is not running from an application bundle"))?;
    // Gatekeeper runs quarantined apps from a read-only randomized copy.
    if bundle
        .components()
        .any(|component| component.as_os_str() == "AppTranslocation")
    {
        return Err(update_error(
            "Move Locution Pro to the Applications folder before updating",
        ));
    }
    Ok(bundle.to_owned())
}

fn stage(archive: &Path, version: &str, bundle: &Path, staging: &Path) -> AppResult<PathBuf> {
    // bsdtar refuses absolute paths and ".." members unless -P is given.
    run(
        "/usr/bin/tar",
        [
            "-xzf".as_ref(),
            archive.as_os_str(),
            "-C".as_ref(),
            staging.as_os_str(),
        ],
    )?;
    let mut entries = fs::read_dir(staging)
        .map_err(|error| update_error(error.to_string()))?
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| update_error(error.to_string()))?;
    entries.sort();
    if entries != [BUNDLE_NAME, REUSE_MANIFEST] {
        return Err(invalid_update("Unexpected update archive contents"));
    }
    let staged = staging.join(BUNDLE_NAME);
    let manifest: ReuseManifest = serde_json::from_slice(
        &fs::read(staging.join(REUSE_MANIFEST)).map_err(|error| update_error(error.to_string()))?,
    )
    .map_err(|error| invalid_update(format!("Read {REUSE_MANIFEST}: {error}")))?;
    if manifest.version != version {
        return Err(invalid_update("Update archive version mismatch"));
    }
    for file in &manifest.files {
        reuse(file, bundle, &staged)?;
    }
    let plist = staged.join("Contents").join("Info.plist");
    if plist_value(&plist, "CFBundleIdentifier")? != BUNDLE_IDENTIFIER
        || plist_value(&plist, "CFBundleShortVersionString")? != version
    {
        return Err(invalid_update(
            "Update bundle identifier or version mismatch",
        ));
    }
    // The seal covers every file, including the reused ones, and rejects extras.
    run(
        "/usr/bin/codesign",
        [
            "--verify".as_ref(),
            "--deep".as_ref(),
            "--strict".as_ref(),
            staged.as_os_str(),
        ],
    )?;
    Ok(staged)
}

fn reuse(file: &ReusedFile, bundle: &Path, staged: &Path) -> AppResult<()> {
    let relative = Path::new(&file.path);
    if !relative.starts_with("Contents")
        || !relative
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
    {
        return Err(invalid_update(format!(
            "Invalid reused file path {}",
            file.path
        )));
    }
    let source = bundle.join(relative);
    let mismatch = || {
        update_error(format!(
            "{} differs from the update; install the full release",
            file.path
        ))
    };
    let metadata = fs::symlink_metadata(&source).map_err(|_| mismatch())?;
    if !metadata.is_file() || metadata.len() != file.size {
        return Err(mismatch());
    }
    let mut reader = fs::File::open(&source).map_err(|error| update_error(error.to_string()))?;
    let mut hash = Sha256::new();
    std::io::copy(&mut reader, &mut hash).map_err(|error| update_error(error.to_string()))?;
    if format!("{:x}", hash.finalize()) != file.sha256.to_ascii_lowercase() {
        return Err(mismatch());
    }
    let target = staged.join(relative);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(invalid_update(format!(
            "{} is both bundled and reused",
            file.path
        )));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| update_error(error.to_string()))?;
    }
    // APFS clones the file, so reusing the models costs no extra space or time.
    fs::copy(&source, &target).map_err(|error| update_error(error.to_string()))?;
    Ok(())
}

fn swap(staged: &Path, bundle: &Path) -> AppResult<()> {
    let parent = bundle
        .parent()
        .ok_or_else(|| update_error("Missing application directory"))?;
    let backup = parent.join(format!(".locution-pro-rollback-{}.app", Uuid::new_v4()));
    fs::rename(bundle, &backup)
        .map_err(|error| update_error(format!("Move the current application aside: {error}")))?;
    if let Err(error) = fs::rename(staged, bundle) {
        if let Err(restore) = fs::rename(&backup, bundle) {
            return Err(update_error(format!(
                "Install the update: {error}; restoring failed ({restore}), the previous application is at {}",
                backup.display()
            )));
        }
        return Err(update_error(format!("Install the update: {error}")));
    }
    if let Err(error) = fs::remove_dir_all(&backup) {
        tracing::warn!(%error, backup = %backup.display(), "Remove the previous application");
    }
    Ok(())
}

fn relaunch(bundle: &Path, project: Option<&str>) -> AppResult<()> {
    // Wait for this process to exit so the new instance never overlaps it.
    let mut command = StdCommand::new("/bin/sh");
    command
        .arg("-c")
        .arg(r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; app="$2"; shift 2; exec /usr/bin/open "$app" --args "$@""#)
        .arg("locution-pro-relaunch")
        .arg(std::process::id().to_string())
        .arg(bundle);
    if let Some(project) = project {
        command.arg(project);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| update_error(format!("Relaunch Locution Pro: {error}")))?;
    Ok(())
}

fn plist_value(plist: &Path, key: &str) -> AppResult<String> {
    let output = run(
        "/usr/bin/plutil",
        [
            "-extract".as_ref(),
            key.as_ref(),
            "raw".as_ref(),
            "-o".as_ref(),
            "-".as_ref(),
            plist.as_os_str(),
        ],
    )?;
    Ok(output.trim().to_owned())
}

fn run<'a>(
    program: &str,
    arguments: impl IntoIterator<Item = &'a std::ffi::OsStr>,
) -> AppResult<String> {
    let output = StdCommand::new(program)
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| update_error(format!("Run {program}: {error}")))?;
    if !output.status.success() {
        return Err(update_error(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_paths_stay_inside_the_bundle_contents() {
        let root = env::temp_dir().join(format!("locution-reuse-{}", Uuid::new_v4()));
        let bundle = root.join("current.app");
        let staged = root.join("staged.app");
        fs::create_dir_all(bundle.join("Contents/Resources")).unwrap();
        fs::create_dir_all(&staged).unwrap();
        let bytes = b"model weights";
        fs::write(bundle.join("Contents/Resources/model.onnx"), bytes).unwrap();
        let file = |path: &str, size, sha256: String| ReusedFile {
            path: path.into(),
            size,
            sha256,
        };
        let digest = format!("{:x}", Sha256::digest(bytes));
        for path in [
            "../current.app/Contents/Resources/model.onnx",
            "/etc/hosts",
            "Resources/model.onnx",
        ] {
            assert!(reuse(&file(path, 13, digest.clone()), &bundle, &staged).is_err());
        }
        let path = "Contents/Resources/model.onnx";
        assert!(reuse(&file(path, 12, digest.clone()), &bundle, &staged).is_err());
        assert!(reuse(&file(path, 13, "0".repeat(64)), &bundle, &staged).is_err());
        reuse(&file(path, 13, digest.clone()), &bundle, &staged).unwrap();
        assert_eq!(fs::read(staged.join(path)).unwrap(), bytes);
        assert!(reuse(&file(path, 13, digest), &bundle, &staged).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    /// LOCUTION_UPDATE_TEST_BUNDLE is replaced in place; use a disposable copy.
    #[test]
    #[ignore = "needs a disposable application bundle and an update archive"]
    fn replaces_a_real_bundle_from_an_update_archive() {
        let variable = |name| env::var(name).unwrap_or_else(|_| panic!("set {name}"));
        replace_bundle(
            Path::new(&variable("LOCUTION_UPDATE_TEST_ARCHIVE")),
            &variable("LOCUTION_UPDATE_TEST_VERSION"),
            Path::new(&variable("LOCUTION_UPDATE_TEST_BUNDLE")),
        )
        .unwrap();
    }

    #[test]
    fn a_failed_swap_restores_the_current_bundle() {
        let root = env::temp_dir().join(format!("locution-swap-{}", Uuid::new_v4()));
        let bundle = root.join("Locution Pro.app");
        fs::create_dir_all(bundle.join("Contents")).unwrap();
        fs::write(bundle.join("Contents/marker"), b"current").unwrap();
        assert!(swap(&root.join("missing.app"), &bundle).is_err());
        assert_eq!(
            fs::read(bundle.join("Contents/marker")).unwrap(),
            b"current"
        );
        let staged = root.join("staged.app");
        fs::create_dir_all(staged.join("Contents")).unwrap();
        fs::write(staged.join("Contents/marker"), b"update").unwrap();
        swap(&staged, &bundle).unwrap();
        assert_eq!(fs::read(bundle.join("Contents/marker")).unwrap(), b"update");
        let leftovers: Vec<_> = fs::read_dir(&root).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
