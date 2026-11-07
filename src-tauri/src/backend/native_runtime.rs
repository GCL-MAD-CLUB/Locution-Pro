//! Native dependency checks shared by features that load libraries at runtime.
use crate::error::AppResult;
#[cfg(any(windows, test))]
use crate::error::{app_error, AppError, ErrorCode};
use std::path::Path;

// Only probed on Windows; other platforms rely on the dynamic loader's own errors.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) enum NativeDependency<'a> {
    VisualCpp,
    Library(&'a Path),
}

/// Check on demand before entering a native loader that may panic. Failures are
/// never cached, so a later attempt can succeed after the environment is repaired.
pub(super) fn check_dependencies(dependencies: &[NativeDependency<'_>]) -> AppResult<()> {
    #[cfg(windows)]
    for dependency in dependencies {
        match dependency {
            NativeDependency::VisualCpp => {
                for module in MSVC_RUNTIME_DLLS {
                    probe_module(Path::new(module))
                        .map_err(|failure| dependency_error(true, failure))?;
                }
            }
            NativeDependency::Library(path) => {
                probe_module(path).map_err(|failure| dependency_error(false, failure))?;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = dependencies;
    Ok(())
}

#[cfg(windows)]
const MSVC_RUNTIME_DLLS: [&str; 4] = [
    "MSVCP140.dll",
    "MSVCP140_1.dll",
    "VCRUNTIME140.dll",
    "VCRUNTIME140_1.dll",
];

#[cfg(any(windows, test))]
#[derive(Debug)]
struct ModuleLoadFailure {
    module: String,
    win32_code: u32,
    message: String,
}

#[cfg(windows)]
fn probe_module(path: &Path) -> Result<(), ModuleLoadFailure> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::FreeLibrary;
    use windows::Win32::System::LibraryLoader::{
        LoadLibraryExW, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
    };

    let name = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let flags = if path.is_absolute() {
        LOAD_LIBRARY_SEARCH_DEFAULT_DIRS | LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR
    } else {
        LOAD_LIBRARY_SEARCH_DEFAULT_DIRS
    };
    // SAFETY: `name` is NUL terminated and outlives the synchronous call. An
    // absolute library also searches its own directory for packaged dependencies.
    match unsafe { LoadLibraryExW(PCWSTR(name.as_ptr()), None, flags) } {
        Ok(handle) => {
            // SAFETY: this reference was acquired above and is released once.
            unsafe {
                let _ = FreeLibrary(handle);
            }
            Ok(())
        }
        Err(error) => {
            let win32_code = error.code().0 as u32 & 0xFFFF;
            Err(ModuleLoadFailure {
                module: path.display().to_string(),
                win32_code,
                message: std::io::Error::from_raw_os_error(win32_code as i32).to_string(),
            })
        }
    }
}

#[cfg(any(windows, test))]
fn dependency_error(visual_cpp: bool, failure: ModuleLoadFailure) -> AppError {
    let detail = format!(
        "Failed to load native runtime module {} (Windows error {}: {})",
        failure.module, failure.win32_code, failure.message
    );
    match (visual_cpp, failure.win32_code) {
        (true, 126 | 127 | 193) => app_error(ErrorCode::VcRuntimeMissing, detail),
        // A packaged library can fail even after VC++ DLLs load successfully:
        // an older redistributable may lack a required DLL or entry point.
        // Preserve that repair option without claiming VC++ is the only cause
        // (an incompatible or damaged packaged library can fail the same way).
        (false, 126 | 127 | 193) => {
            app_error(ErrorCode::NativeRuntimeDependencyUnavailable, detail)
        }
        _ => app_error(ErrorCode::NativeRuntimeLoadFailed, detail),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failure(module: &str, win32_code: u32) -> ModuleLoadFailure {
        ModuleLoadFailure {
            module: module.into(),
            win32_code,
            message: "loader failure".into(),
        }
    }

    #[test]
    fn visual_cpp_module_failures_offer_runtime_repair() {
        for code in [126, 127, 193] {
            let error = dependency_error(true, failure("MSVCP140.dll", code));
            assert!(error.is(ErrorCode::VcRuntimeMissing));
            assert!(error.detail().contains("MSVCP140.dll"));
            assert!(error.detail().contains(&code.to_string()));
        }
    }

    #[test]
    fn packaged_library_dependency_failures_keep_the_visual_cpp_repair_option() {
        for code in [126, 127, 193] {
            let error = dependency_error(false, failure("onnxruntime.dll", code));
            assert!(error.is(ErrorCode::NativeRuntimeDependencyUnavailable));
            assert!(error.detail().contains("onnxruntime.dll"));
            assert!(error.detail().contains(&code.to_string()));
        }
    }

    #[test]
    fn access_denied_is_not_reported_as_missing_visual_cpp() {
        for (visual_cpp, module) in [(true, "MSVCP140.dll"), (false, "onnxruntime.dll")] {
            assert!(dependency_error(visual_cpp, failure(module, 5))
                .is(ErrorCode::NativeRuntimeLoadFailed));
        }
    }

    #[test]
    #[cfg(windows)]
    fn loader_preserves_missing_module_diagnostics() {
        let failure = probe_module(Path::new("linecut-test-nonexistent-runtime.dll")).unwrap_err();
        assert_eq!(failure.win32_code, 126);
        assert!(failure
            .module
            .contains("linecut-test-nonexistent-runtime.dll"));
    }
}
