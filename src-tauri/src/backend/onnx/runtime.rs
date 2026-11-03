//! Process-wide ONNX initialization, independent of any model or feature.
use crate::backend::native_runtime::{check_dependencies, NativeDependency};
use crate::error::{app_error, AppResult, ErrorCode};
use std::{
    env,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{path::BaseDirectory, Manager};

// The installer currently packages the shared libraries alongside TransNetV2.
const RESOURCE_DIR: &str = "transnetv2";
#[cfg(windows)]
pub(crate) const ONNXRUNTIME_DLL_FILE: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
pub(crate) const ONNXRUNTIME_DLL_FILE: &str = "libonnxruntime.dylib";
#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) const ONNXRUNTIME_DLL_FILE: &str = "libonnxruntime.so";
static INIT_LOCK: Mutex<()> = Mutex::new(());
static READY: OnceLock<()> = OnceLock::new();

#[derive(Clone)]
pub(crate) struct OnnxRuntimePaths {
    pub directory: PathBuf,
    onnxruntime: PathBuf,
}

impl OnnxRuntimePaths {
    pub fn resolve(app: &tauri::AppHandle) -> AppResult<Self> {
        let mut candidates = Vec::new();
        if let Ok(path) = app.path().resolve(RESOURCE_DIR, BaseDirectory::Resource) {
            candidates.push(path);
        }
        if let Ok(exe) = env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join(RESOURCE_DIR));
                candidates.push(dir.join("resources").join(RESOURCE_DIR));
            }
        }
        // Release builds deliberately skip the working directory so the app
        // never loads ONNX DLLs from an untrusted location; the resource and
        // executable directories cover every packaged layout.
        #[cfg(debug_assertions)]
        if let Ok(cwd) = env::current_dir() {
            candidates.push(cwd.join("src-tauri/resources").join(RESOURCE_DIR));
            candidates.push(cwd.join("resources").join(RESOURCE_DIR));
        }
        Self::from_candidates(&candidates)
    }

    fn from_candidates(candidates: &[PathBuf]) -> AppResult<Self> {
        for directory in candidates {
            let onnxruntime = directory.join(ONNXRUNTIME_DLL_FILE);
            if onnxruntime.is_file() {
                return Ok(Self {
                    directory: directory.clone(),
                    onnxruntime,
                });
            }
        }
        let searched = candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("; ");
        let detail = format!(
            "Expected {ONNXRUNTIME_DLL_FILE} in the shared runtime resources; searched: {searched}"
        );
        Err(app_error(ErrorCode::NativeRuntimeMissing, detail))
    }
}

pub(crate) fn initialize(app: &tauri::AppHandle) -> AppResult<()> {
    if READY.get().is_some() {
        return Ok(());
    }
    initialize_from(&OnnxRuntimePaths::resolve(app)?)
}

pub(crate) fn initialize_from(runtime: &OnnxRuntimePaths) -> AppResult<()> {
    if READY.get().is_some() {
        return Ok(());
    }
    let _guard = INIT_LOCK.lock().map_err(|_| {
        app_error(
            ErrorCode::NativeRuntimeLoadFailed,
            "ONNX Runtime initialization lock is poisoned",
        )
    })?;
    if READY.get().is_some() {
        return Ok(());
    }

    // DirectML is optional: provider registration handles its load failures and
    // falls back to CPU. CPU-only models must not load or validate DirectML.
    configure_dll_search(&runtime.directory)?;
    check_dependencies(&[
        NativeDependency::VisualCpp,
        NativeDependency::Library(&runtime.onnxruntime),
    ])?;
    let result = std::panic::catch_unwind(|| {
        ort::init_from(runtime.onnxruntime.to_string_lossy().into_owned())
            .with_name("locution-pro")
            .with_telemetry(false)
            .commit()
    });
    match result {
        Ok(Ok(_)) => {
            let _ = READY.set(());
            Ok(())
        }
        Ok(Err(error)) => Err(app_error(
            ErrorCode::NativeRuntimeLoadFailed,
            format!("Failed to initialize ONNX Runtime: {error}"),
        )),
        Err(payload) => Err(app_error(
            ErrorCode::NativeRuntimeLoadFailed,
            format!(
                "Failed to load ONNX Runtime from {}: {}",
                runtime.onnxruntime.display(),
                panic_payload_text(payload.as_ref())
            ),
        )),
    }
}

/// Keep the packaged directory available to `ort`'s unflagged library loader
/// and delayed provider loads. This changes the Windows process DLL search
/// directory for the remainder of its lifetime, including child DLL searches;
/// it does not change the environment or executable lookup through PATH.
pub(crate) fn configure_dll_search(directory: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::System::LibraryLoader::SetDllDirectoryW;

        if !directory.is_absolute() {
            return Err(app_error(
                ErrorCode::NativeRuntimeLoadFailed,
                format!(
                    "Runtime DLL search directory must be absolute: {}",
                    directory.display()
                ),
            ));
        }
        let name = directory
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        // SAFETY: `name` is NUL terminated and valid for the synchronous call.
        unsafe { SetDllDirectoryW(PCWSTR(name.as_ptr())) }.map_err(|error| {
            app_error(
                ErrorCode::NativeRuntimeLoadFailed,
                format!(
                    "Failed to configure runtime DLL search directory {}: {error}",
                    directory.display()
                ),
            )
        })?;
    }
    #[cfg(not(windows))]
    let _ = directory;
    Ok(())
}

fn panic_payload_text(payload: &(dyn std::any::Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic payload")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn dll_search_resolves_sibling_library_without_changing_path() {
        const CHILD: &str = "LINECUT_DLL_SEARCH_TEST_CHILD";
        if env::var_os(CHILD).is_none() {
            // Isolate the process DLL search setting from parallel unit tests.
            let output = std::process::Command::new(env::current_exe().unwrap())
                .env(CHILD, "1")
                .args([
                    "--exact",
                    "backend::onnx::runtime::tests::dll_search_resolves_sibling_library_without_changing_path",
                    "--nocapture",
                ])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        use windows::core::PCWSTR;
        use windows::Win32::{Foundation::FreeLibrary, System::LibraryLoader::LoadLibraryW};

        let directory =
            env::temp_dir().join(format!("linecut DLL search-依赖-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let library_name = "linecut-dll-search-test.dll";
        // Use a harmless Windows library: no packaged model, GPU or encoding.
        let system_library =
            PathBuf::from(env::var_os("SystemRoot").unwrap()).join("System32/version.dll");
        std::fs::copy(system_library, directory.join(library_name)).unwrap();
        let original_path = env::var_os("PATH");
        configure_dll_search(&directory).unwrap();
        assert_eq!(env::var_os("PATH"), original_path);
        let name = library_name
            .encode_utf16()
            .chain(Some(0))
            .collect::<Vec<_>>();
        // SAFETY: the buffer is NUL terminated and outlives the call.
        let handle = unsafe { LoadLibraryW(PCWSTR(name.as_ptr())) }
            .expect("the bare library name must resolve through the configured directory");
        // SAFETY: release the reference acquired above exactly once.
        unsafe { FreeLibrary(handle) }.unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_resolution_requires_onnx_without_requiring_directml_or_a_model() {
        let directory = env::temp_dir().join(format!("linecut-runtime-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        assert!(
            OnnxRuntimePaths::from_candidates(std::slice::from_ref(&directory))
                .err()
                .unwrap()
                .is(ErrorCode::NativeRuntimeMissing)
        );
        std::fs::write(directory.join(ONNXRUNTIME_DLL_FILE), []).unwrap();
        assert_eq!(
            OnnxRuntimePaths::from_candidates(std::slice::from_ref(&directory))
                .unwrap()
                .directory,
            directory
        );
        // A present but unusable GPU DLL must not block CPU runtime resolution.
        std::fs::write(
            directory.join("DirectML.dll"),
            b"invalid optional GPU library",
        )
        .unwrap();
        assert_eq!(
            OnnxRuntimePaths::from_candidates(std::slice::from_ref(&directory))
                .unwrap()
                .directory,
            directory
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn panic_diagnostics_preserve_supported_payloads() {
        assert_eq!(panic_payload_text(&"borrowed failure"), "borrowed failure");
        assert_eq!(
            panic_payload_text(&String::from("owned failure")),
            "owned failure"
        );
        assert_eq!(panic_payload_text(&7u8), "unknown panic payload");
    }
}
