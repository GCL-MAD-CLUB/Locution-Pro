//! Shared ONNX provider selection and recovery for every production model.
#[cfg(target_os = "macos")]
mod coreml;
pub(super) mod runtime;
use super::{available_cpu_threads, check_optional_cancel, AppError, AppResult};
use ort::{
    execution_providers::DirectMLExecutionProvider,
    session::{builder::GraphOptimizationLevel, Session},
};
use std::{
    fmt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[cfg(not(target_os = "macos"))]
const MAX_DIRECTML_ADAPTERS: i32 = 8;
#[cfg(not(target_os = "macos"))]
static PREFERRED_ADAPTER: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);

/// GPU providers a model may use. DirectML accelerates every production
/// model, while CoreML lacks 3D convolutions and most quantized operators; a
/// partially supported graph splits into CPU/GPU partitions and runs slower
/// than plain CPU, so CoreML is opt-in per model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Accelerators {
    All,
    DirectMlOnly,
}

// Clones observe a runtime fallback too, so task completion reports the provider
// actually used rather than the provider selected at initialization.
#[derive(Clone)]
pub(super) struct SessionProvider {
    initial: Arc<str>,
    cpu: Arc<AtomicBool>,
}

impl From<String> for SessionProvider {
    fn from(name: String) -> Self {
        Self {
            cpu: Arc::new(AtomicBool::new(name == "CPU")),
            initial: name.into(),
        }
    }
}

impl From<&str> for SessionProvider {
    fn from(name: &str) -> Self {
        name.to_string().into()
    }
}

impl SessionProvider {
    /// Whether inference runs on CPU now, including after a runtime fallback.
    pub(super) fn is_cpu(&self) -> bool {
        self.cpu.load(Ordering::Relaxed)
    }
}

impl fmt::Display for SessionProvider {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_cpu() {
            formatter.write_str("CPU")
        } else {
            formatter.write_str(&self.initial)
        }
    }
}

pub(super) struct OnnxModel {
    session: Mutex<Session>,
    provider: SessionProvider,
    path: PathBuf,
    dimensions: Vec<(String, i64)>,
    // Callers classify failures at the source; recovery only adds diagnostics.
    make_error: fn(String) -> AppError,
    recover: bool,
}

impl OnnxModel {
    pub fn load(
        path: &Path,
        dimensions: &[(&str, i64)],
        accelerators: Accelerators,
        make_error: fn(String) -> AppError,
    ) -> AppResult<Self> {
        let (session, provider) =
            create_model_session_with_dimensions(path, dimensions, accelerators).map_err(
                |error| make_error(format!("Load ONNX model {}: {error}", path.display())),
            )?;
        Ok(Self {
            session: Mutex::new(session),
            provider: provider.into(),
            path: path.to_owned(),
            dimensions: dimensions
                .iter()
                .map(|&(name, size)| (name.to_owned(), size))
                .collect(),
            make_error,
            recover: true,
        })
    }

    pub fn provider(&self) -> SessionProvider {
        self.provider.clone()
    }

    // Batch tuning first retries a smaller accelerated shape. A speculative
    // large-batch OOM must not retire an otherwise healthy GPU model family.
    pub fn run_without_recovery<T>(
        &self,
        cancel: &AtomicBool,
        infer: impl FnOnce(&Session) -> ort::Result<T>,
    ) -> AppResult<T> {
        check_optional_cancel(Some(cancel))?;
        let session = self
            .session
            .lock()
            .map_err(|e| (self.make_error)(e.to_string()))?;
        let result = infer(&session);
        check_optional_cancel(Some(cancel))?;
        result.map_err(|e| {
            (self.make_error)(format!(
                "ONNX batch inference on {} failed: {e}",
                self.provider
            ))
        })
    }

    // A model family that already recovered to CPU must not reprobe failing
    // GPU providers whenever its batch-specialized shape changes.
    pub fn load_cpu(
        path: &Path,
        dimensions: &[(&str, i64)],
        make_error: fn(String) -> AppError,
    ) -> AppResult<Self> {
        let session = create_cpu_model_session_with_dimensions(path, dimensions)
            .map_err(|e| make_error(format!("Load CPU ONNX model {}: {e}", path.display())))?;
        Ok(Self {
            session: Mutex::new(session),
            provider: "CPU".into(),
            path: path.to_owned(),
            dimensions: dimensions
                .iter()
                .map(|&(name, size)| (name.to_owned(), size))
                .collect(),
            make_error,
            recover: false,
        })
    }

    // Return owned outputs: the failed session can be replaced only after every
    // output from its failed attempt has been dropped. Callers reuse the same
    // inputs and publish results only after this method succeeds.
    pub fn run<T>(
        &self,
        cancel: Option<&AtomicBool>,
        mut infer: impl FnMut(&Session) -> ort::Result<T>,
    ) -> AppResult<T> {
        let mut session = self
            .session
            .lock()
            .map_err(|error| (self.make_error)(error.to_string()))?;
        run_with_fallback(
            &mut *session,
            &self.provider,
            cancel,
            self.make_error,
            self.recover,
            |session| {
                infer(session).map_err(|error| {
                    ort::Error::new(format!("Model {}: {error}", self.path.display()))
                })
            },
            || {
                let dimensions = self
                    .dimensions
                    .iter()
                    .map(|(name, size)| (name.as_str(), *size))
                    .collect::<Vec<_>>();
                create_cpu_model_session_with_dimensions(&self.path, &dimensions)
            },
        )
    }

    // Provider-specific diagnostic tests intentionally bypass automatic recovery.
    #[cfg(test)]
    pub fn from_session(session: Session, make_error: fn(String) -> AppError) -> Self {
        Self {
            session: Mutex::new(session),
            provider: "Explicit test provider".into(),
            path: PathBuf::new(),
            dimensions: Vec::new(),
            make_error,
            recover: false,
        }
    }
}

fn run_with_fallback<S, T>(
    session: &mut S,
    provider: &SessionProvider,
    cancel: Option<&AtomicBool>,
    make_error: fn(String) -> AppError,
    recover: bool,
    mut infer: impl FnMut(&S) -> ort::Result<T>,
    cpu: impl FnOnce() -> ort::Result<S>,
) -> AppResult<T> {
    check_optional_cancel(cancel)?;
    let result = match infer(session) {
        Ok(result) => result,
        Err(error) => {
            check_optional_cancel(cancel)?;
            if !recover || provider.cpu.load(Ordering::Relaxed) {
                return Err(make_error(format!(
                    "ONNX inference on {provider} failed: {error}"
                )));
            }
            tracing::warn!(%provider, %error, "ONNX inference failed; retrying the same inputs on CPU");
            let replacement = match cpu() {
                Ok(session) => session,
                Err(cpu_error) => {
                    check_optional_cancel(cancel)?;
                    return Err(make_error(format!(
                        "ONNX inference on {provider} failed: {error}; CPU initialization failed: {cpu_error}"
                    )));
                }
            };
            *session = replacement;
            provider.cpu.store(true, Ordering::Relaxed);
            check_optional_cancel(cancel)?;
            let retry = infer(session);
            check_optional_cancel(cancel)?;
            let result = retry.map_err(|cpu_error| {
                make_error(format!(
                    "ONNX accelerated inference failed: {error}; CPU retry failed: {cpu_error}"
                ))
            })?;
            tracing::info!(
                provider = "CPU",
                "ONNX CPU retry succeeded; retaining CPU for subsequent inference"
            );
            result
        }
    };
    check_optional_cancel(cancel)?;
    Ok(result)
}

#[cfg(target_os = "macos")]
pub(super) fn create_model_session_with_dimensions(
    path: &Path,
    dimensions: &[(&str, i64)],
    accelerators: Accelerators,
) -> ort::Result<(Session, String)> {
    let coreml = match accelerators {
        Accelerators::All => coreml::create_session(path, dimensions),
        Accelerators::DirectMlOnly => Err(ort::Error::new("CoreML does not accelerate this model")),
    };
    match coreml {
        Ok(session) => {
            tracing::info!(provider = "CoreML", model_path = %path.display(), "Selected ONNX inference provider");
            Ok((session, "CoreML".to_string()))
        }
        Err(error) => {
            tracing::info!(model_path = %path.display(), %error, "Using CPU ONNX inference provider instead of CoreML");
            create_cpu_model_session_with_dimensions(path, dimensions)
                .map(|session| (session, "CPU".to_string()))
                .map_err(|cpu| {
                    ort::Error::new(format!(
                        "CoreML unavailable ({error}); CPU initialization failed: {cpu}"
                    ))
                })
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn create_model_session_with_dimensions(
    path: &Path,
    dimensions: &[(&str, i64)],
    _accelerators: Accelerators,
) -> ort::Result<(Session, String)> {
    let preferred = PREFERRED_ADAPTER.load(Ordering::Relaxed);
    let adapters = (preferred >= 0)
        .then_some(preferred)
        .into_iter()
        .chain((0..MAX_DIRECTML_ADAPTERS).filter(|adapter| *adapter != preferred));
    let mut errors = Vec::new();
    for adapter in adapters {
        match create_directml_model_session_with_dimensions(path, adapter, dimensions) {
            Ok(session) => {
                PREFERRED_ADAPTER.store(adapter, Ordering::Relaxed);
                tracing::info!(provider = "DirectML", adapter, model_path = %path.display(), "Selected ONNX inference provider");
                return Ok((session, format!("DirectML (adapter {adapter})")));
            }
            Err(error) => {
                tracing::warn!(adapter, model_path = %path.display(), %error, "DirectML ONNX initialization failed for display adapter");
                errors.push(format!("adapter {adapter}: {error}"));
            }
        }
    }
    tracing::warn!(model_path = %path.display(), "No usable DirectML display adapter was found; retrying with CPU");
    create_cpu_model_session_with_dimensions(path, dimensions)
        .map(|session| {
            tracing::info!(provider = "CPU", model_path = %path.display(), "Selected ONNX inference provider after DirectML fallback");
            (session, "CPU".to_string())
        })
        .map_err(|error| ort::Error::new(format!("DirectML initialization failed ({}); CPU initialization failed: {error}", errors.join("; "))))
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(super) fn create_directml_model_session_with_dimensions(
    path: &Path,
    adapter: i32,
    dimensions: &[(&str, i64)],
) -> ort::Result<Session> {
    // DirectML requires sequential execution, disabled memory patterns, and
    // serialized Run calls (enforced by OnnxModel's session mutex).
    let mut builder = Session::builder()?
        .with_parallel_execution(false)?
        .with_memory_pattern(false)?
        .with_execution_providers([DirectMLExecutionProvider::default()
            .with_device_id(adapter)
            .build()
            .error_on_failure()])?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_intra_threads(1)?;
    for &(name, size) in dimensions {
        builder = builder.with_dimension_override(name, size)?;
    }
    builder.commit_from_file(path)
}

pub(super) fn create_cpu_model_session_with_dimensions(
    path: &Path,
    dimensions: &[(&str, i64)],
) -> ort::Result<Session> {
    let threads = cpu_thread_budget(available_cpu_threads());
    tracing::info!(threads, "Configured ONNX CPU inference threads");
    let session = |level| {
        let mut builder = Session::builder()?
            .with_optimization_level(level)?
            .with_intra_threads(threads)?;
        for &(name, size) in dimensions {
            builder = builder.with_dimension_override(name, size)?;
        }
        builder.commit_from_file(path)
    };
    // Extended fusions can fail on some graphs and CPUs (on Apple silicon, the
    // fp16 SigLIP2 vision model breaks SimplifiedLayerNormFusion); basic
    // optimizations still give a correct, slower session.
    session(GraphOptimizationLevel::Level3).or_else(|error| {
        tracing::warn!(model_path = %path.display(), %error, "ONNX CPU graph optimization failed; retrying with basic optimizations");
        session(GraphOptimizationLevel::Level1)
    })
}

// Reserve CPU capacity for decoding and UI work.
pub(super) fn cpu_thread_budget(available: usize) -> usize {
    (available / 2).clamp(1, 8)
}

#[cfg(test)]
pub(super) fn create_model_session(path: &Path) -> ort::Result<(Session, String)> {
    create_model_session_with_dimensions(path, &[], Accelerators::All)
}

#[cfg(test)]
pub(super) fn create_cpu_model_session(path: &Path) -> ort::Result<Session> {
    create_cpu_model_session_with_dimensions(path, &[])
}

/// The platform GPU provider without CPU recovery, for parity tests.
#[cfg(test)]
pub(super) fn create_gpu_model_session_with_dimensions(
    path: &Path,
    dimensions: &[(&str, i64)],
) -> ort::Result<Session> {
    #[cfg(target_os = "macos")]
    return coreml::create_session(path, dimensions);
    #[cfg(not(target_os = "macos"))]
    create_directml_model_session_with_dimensions(path, 0, dimensions)
}

#[cfg(test)]
mod tests {
    //! Recovery state tests: no model files, runtime DLLs, GPU, or media decoding.
    use super::super::{app_error, ErrorCode};
    use super::*;
    use std::cell::{Cell, RefCell};

    fn inference_error(detail: String) -> AppError {
        app_error(ErrorCode::SemanticInferenceFailed, detail)
    }

    #[test]
    fn successful_gpu_run_does_not_initialize_cpu() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML");
        let result = run_with_fallback(
            &mut session,
            &provider,
            None,
            inference_error,
            true,
            |_| Ok(42),
            || -> ort::Result<i32> { panic!("CPU is unnecessary") },
        )
        .unwrap();
        assert_eq!(result, 42);
        assert_eq!(provider.to_string(), "DirectML");
    }

    #[test]
    fn failed_gpu_batch_retries_identical_inputs_and_keeps_cpu_for_next_batch() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML (adapter 2)");
        let status = provider.clone();
        let calls = RefCell::new(Vec::new());
        let cpu_loads = Cell::new(0);
        for input in [vec![3, 7, 11], vec![19]] {
            let output = run_with_fallback(
                &mut session,
                &provider,
                None,
                inference_error,
                true,
                |session| {
                    calls.borrow_mut().push((*session, input.clone()));
                    if *session == 0 {
                        Err(ort::Error::new("GPU reshape failed"))
                    } else {
                        Ok(input.clone())
                    }
                },
                || {
                    cpu_loads.set(cpu_loads.get() + 1);
                    Ok(1)
                },
            )
            .unwrap();
            assert_eq!(output, input);
        }
        assert_eq!(
            *calls.borrow(),
            [(0, vec![3, 7, 11]), (1, vec![3, 7, 11]), (1, vec![19])]
        );
        assert_eq!(cpu_loads.get(), 1);
        assert_eq!(status.to_string(), "CPU");
    }

    #[test]
    fn cancellation_after_gpu_failure_skips_cpu_loading_and_retry() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML");
        let cancel = AtomicBool::new(false);
        let error = run_with_fallback(
            &mut session,
            &provider,
            Some(&cancel),
            inference_error,
            true,
            |_| -> ort::Result<()> {
                cancel.store(true, Ordering::SeqCst);
                Err(ort::Error::new("GPU failed"))
            },
            || -> ort::Result<i32> { panic!("Cancelled work must not load a model") },
        )
        .unwrap_err();
        assert!(error.is(ErrorCode::TaskCancelled));
        assert_eq!(provider.to_string(), "DirectML");
    }

    #[test]
    fn cancellation_during_cpu_loading_skips_retry() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML");
        let cancel = AtomicBool::new(false);
        let calls = Cell::new(0);
        let error = run_with_fallback(
            &mut session,
            &provider,
            Some(&cancel),
            inference_error,
            true,
            |_| -> ort::Result<()> {
                calls.set(calls.get() + 1);
                Err(ort::Error::new("GPU failed"))
            },
            || {
                cancel.store(true, Ordering::SeqCst);
                Ok(1)
            },
        )
        .unwrap_err();
        assert!(error.is(ErrorCode::TaskCancelled));
        assert_eq!(calls.get(), 1);
        assert_eq!(provider.to_string(), "CPU");
    }

    #[test]
    fn failed_cpu_retry_keeps_both_causes_and_does_not_retry_cpu_forever() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML");
        let error = run_with_fallback(
            &mut session,
            &provider,
            None,
            inference_error,
            true,
            |session| -> ort::Result<()> {
                Err(ort::Error::new(if *session == 0 {
                    "GPU reshape"
                } else {
                    "CPU kernel"
                }))
            },
            || Ok(1),
        )
        .unwrap_err();
        assert!(error.is(ErrorCode::SemanticInferenceFailed));
        assert!(error.detail().contains("GPU reshape"));
        assert!(error.detail().contains("CPU kernel"));
        assert_eq!(provider.to_string(), "CPU");
        let error = run_with_fallback(
            &mut session,
            &provider,
            None,
            inference_error,
            true,
            |_| -> ort::Result<()> { Err(ort::Error::new("CPU kernel")) },
            || -> ort::Result<i32> { panic!("Already on CPU") },
        )
        .unwrap_err();
        assert!(error.is(ErrorCode::SemanticInferenceFailed));
    }

    #[test]
    fn cpu_load_failure_retains_gpu_state_and_reports_both_causes() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML");
        let error = run_with_fallback(
            &mut session,
            &provider,
            None,
            inference_error,
            true,
            |_| -> ort::Result<()> { Err(ort::Error::new("GPU run failed")) },
            || Err(ort::Error::new("CPU load failed")),
        )
        .unwrap_err();
        assert!(error.detail().contains("GPU run failed"));
        assert!(error.detail().contains("CPU load failed"));
        assert_eq!(session, 0);
        assert_eq!(provider.to_string(), "DirectML");
    }

    #[test]
    fn cancellation_during_cpu_retry_wins_over_inference_error() {
        let mut session = 0;
        let provider = SessionProvider::from("DirectML");
        let cancel = AtomicBool::new(false);
        let error = run_with_fallback(
            &mut session,
            &provider,
            Some(&cancel),
            inference_error,
            true,
            |session| -> ort::Result<()> {
                if *session == 1 {
                    cancel.store(true, Ordering::SeqCst);
                }
                Err(ort::Error::new("Inference failed"))
            },
            || Ok(1),
        )
        .unwrap_err();
        assert!(error.is(ErrorCode::TaskCancelled));
        assert_eq!(provider.to_string(), "CPU");
    }
}
