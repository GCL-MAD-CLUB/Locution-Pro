use std::collections::VecDeque;
#[cfg(test)]
use std::env;
use std::fmt;
use std::fs;
use std::io::{BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex, OnceLock,
};

use ort::{
    session::run_options::{HasSelectedOutputs, OutputSelector, RunOptions},
    value::Tensor,
};
use uuid::Uuid;

#[cfg(test)]
use super::onnx::runtime::{configure_dll_search, ONNXRUNTIME_DLL_FILE};
#[cfg(test)]
pub(super) use super::onnx::{
    cpu_thread_budget as storyboard_cpu_thread_budget, create_cpu_model_session,
    create_gpu_model_session_with_dimensions, create_model_session,
};
use super::onnx::{runtime::OnnxRuntimePaths, OnnxModel, SessionProvider};
use super::*;
#[cfg(test)]
use ort::session::Session;

mod decision;
mod pipeline;
use decision::{
    detect_storyboard_cuts, synthetic_frame_time_us, StoryboardCut, StoryboardDecisionConfig,
};
use pipeline::{
    FrameBlock, FrameQueue, FrameSender, InferenceTask, ProducerMessage, StoryboardConsumer,
};

#[cfg(test)]
const TRANSNET_RESOURCE_DIR: &str = "transnetv2";
const TRANSNET_MODEL_FILE: &str = "transnetv2.onnx";
const STORYBOARD_EVENT_MODEL_FILE: &str = "storyboard-event-model.json";
const STORYBOARD_FRAME_WIDTH: usize = 48;
const STORYBOARD_FRAME_HEIGHT: usize = 27;
const STORYBOARD_FRAME_CHANNELS: usize = 3;
const STORYBOARD_FRAME_BYTES: usize =
    STORYBOARD_FRAME_WIDTH * STORYBOARD_FRAME_HEIGHT * STORYBOARD_FRAME_CHANNELS;
const TRANSNET_WINDOW_FRAMES: usize = 100;
/// Single-frame head. cls_layer1 → Sigmoid, shape [1, 100, 1].
const TRANSNET_SINGLE_FRAME_OUTPUT: &str = "534";
/// Many-hot head. cls_layer2 → Sigmoid, shape [1, 100, 1].
const TRANSNET_MANY_HOT_OUTPUT: &str = "535";
const TRANSNET_OUTPUT_SHAPE: [i64; 3] = [1, TRANSNET_WINDOW_FRAMES as i64, 1];
const TRANSNET_CENTER_START: usize = 25;
const TRANSNET_CENTER_END: usize = 75;
const TRANSNET_STRIDE_FRAMES: usize = 50;
const STORYBOARD_PROGRESS_PREDICT_END: f64 = 0.98;
const STORYBOARD_PROGRESS_MIN_DELTA: f64 = 0.0025;
const STORYBOARD_PROGRESS_FRAME_REPORT_INTERVAL: usize = 25;
/// Used when a video stream has no positive average or real frame rate.
/// Matches the frontend timeline default (`DEFAULT_FRAME_RATE`).
pub(crate) const DEFAULT_MEDIA_FRAME_RATE: f64 = 24.0;
const STORYBOARD_MAX_CONCURRENT_EXTRACTIONS: usize = 3;
const STORYBOARD_MAX_EXTRACTION_THREADS: usize = 16;

static STORYBOARD_CONSUMER: OnceLock<Arc<StoryboardConsumer>> = OnceLock::new();
static STORYBOARD_EXTRACTION_SCHEDULER: OnceLock<StoryboardExtractionScheduler> = OnceLock::new();

fn storyboard_core_limit(physical_cores: Option<usize>, available: usize) -> usize {
    // A topology-query failure must not fall back to counting SMT siblings as
    // independent cores. available_parallelism also limits restricted processes.
    physical_cores.unwrap_or(1).max(1).min(available.max(1))
}

#[cfg(windows)]
fn storyboard_physical_cores() -> Option<usize> {
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::System::SystemInformation::{
        GetLogicalProcessorInformation, RelationProcessorCore, SYSTEM_LOGICAL_PROCESSOR_INFORMATION,
    };

    let mut bytes = 0u32;
    // SAFETY: the first call only writes the required byte count.
    let error = unsafe { GetLogicalProcessorInformation(None, &mut bytes) }.err()?;
    if error.code() != windows::core::HRESULT::from_win32(ERROR_INSUFFICIENT_BUFFER.0) || bytes == 0
    {
        return None;
    }
    let record_size = std::mem::size_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION>();
    let mut records = vec![
        SYSTEM_LOGICAL_PROCESSOR_INFORMATION::default();
        (bytes as usize).div_ceil(record_size)
    ];
    // SAFETY: the aligned records allocation contains at least `bytes` writable
    // bytes and stays alive throughout the synchronous Windows API call.
    unsafe { GetLogicalProcessorInformation(Some(records.as_mut_ptr()), &mut bytes) }.ok()?;
    if bytes as usize % record_size != 0 {
        return None;
    }
    // This API reports the calling processor group. On multi-group machines
    // that is a conservative bound, never larger than the total physical cores.
    let cores = records
        .get(..bytes as usize / record_size)?
        .iter()
        .filter(|record| record.Relationship == RelationProcessorCore)
        .count();
    (cores > 0).then_some(cores)
}

#[cfg(not(windows))]
fn storyboard_physical_cores() -> Option<usize> {
    None
}

struct StoryboardExtractionScheduler {
    threads: usize,
    slots: tokio::sync::Semaphore,
}

impl StoryboardExtractionScheduler {
    fn new(available: usize) -> Self {
        let available = available.max(1);
        let workers = available.min(STORYBOARD_MAX_CONCURRENT_EXTRACTIONS);
        Self {
            // Round down: rounding up would oversubscribe non-multiples of three.
            threads: (available / workers).min(STORYBOARD_MAX_EXTRACTION_THREADS),
            slots: tokio::sync::Semaphore::new(workers),
        }
    }

    async fn acquire(&self, cancel: &AtomicBool) -> AppResult<tokio::sync::SemaphorePermit<'_>> {
        let acquire = self.slots.acquire();
        tokio::pin!(acquire);
        loop {
            ensure_not_cancelled(cancel)?;
            // Keep the same waiter across cancellation polls to preserve FIFO.
            match tokio::time::timeout(pipeline::POLL_INTERVAL, &mut acquire).await {
                Ok(result) => {
                    let permit = result.map_err(|_| {
                        app_error(
                            ErrorCode::TaskStateUnavailable,
                            "Storyboard extraction scheduler is closed",
                        )
                    })?;
                    ensure_not_cancelled(cancel)?;
                    return Ok(permit);
                }
                Err(_) => continue,
            }
        }
    }
}

#[derive(Clone)]
struct StoryboardRuntimePaths {
    onnx: OnnxRuntimePaths,
    model: PathBuf,
    event_model: Option<PathBuf>,
}

struct StoryboardDetectionRequest<'a> {
    app: &'a tauri::AppHandle,
    state: &'a AppState,
    task_id: &'a str,
    project: &'a MediaDocument,
    stream_index: i32,
    preferences: &'a Preferences,
    runtime: &'a StoryboardRuntimePaths,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(super) struct TransnetPredictions {
    pub single_frame: Vec<f32>,
    pub many_hot: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StoryboardShot {
    id: String,
    sequence: usize,
    start_frame: usize,
    end_frame: usize,
    start_us: i64,
    end_us: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoryboardDetectionResult {
    asset_id: String,
    duration_us: i64,
    frame_count: usize,
    frame_rate: f64,
    provider: String,
    cuts: Vec<StoryboardCut>,
    shots: Vec<StoryboardShot>,
}

#[tauri::command]
pub(crate) async fn detect_storyboard_shots(
    media_sources: crate::MediaSources,
    asset_id: String,
    task_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<StoryboardDetectionResult> {
    let task = register_task(&task_id, state.inner())?;
    emit_ffmpeg_progress(&app, &task_id, 0.0);
    let project = media_sources.get(&asset_id)?.clone();
    let stream_index = project.asset.video_stream_index.ok_or_else(|| {
        app_error(
            ErrorCode::VideoStreamMissing,
            format!("Media asset has no video stream for storyboard detection: {asset_id}"),
        )
    })?;
    let preferences = preferences_clone(&state)?;
    let runtime = storyboard_runtime_paths(&app)?;
    task.check_cancelled()?;

    let result = run_storyboard_detection(StoryboardDetectionRequest {
        app: &app,
        state: state.inner(),
        task_id: &task_id,
        project: &project,
        stream_index,
        preferences: &preferences,
        runtime: &runtime,
        cancel: task.cancel_token(),
    })
    .await?;
    task.check_cancelled()?;
    emit_ffmpeg_progress(&app, &task_id, 1.0);
    Ok(result)
}

fn storyboard_runtime_paths(app: &tauri::AppHandle) -> AppResult<StoryboardRuntimePaths> {
    let onnx = OnnxRuntimePaths::resolve(app)?;
    let model = onnx.directory.join(TRANSNET_MODEL_FILE);
    if !model.is_file() {
        return Err(app_error(
            ErrorCode::StoryboardModelMissing,
            format!("TransNetV2 model is missing: {}", model.display()),
        ));
    }
    let event_model = onnx.directory.join(STORYBOARD_EVENT_MODEL_FILE);
    Ok(StoryboardRuntimePaths {
        onnx,
        model,
        event_model: event_model.is_file().then_some(event_model),
    })
}

fn storyboard_ort_error(error_context: &str, error: impl fmt::Display) -> AppError {
    app_error(
        ErrorCode::StoryboardInferenceFailed,
        format!("Failed to {error_context}: {error}"),
    )
}

fn storyboard_decision_config(model_path: Option<&PathBuf>) -> AppResult<StoryboardDecisionConfig> {
    let config = if let Some(model_path) = model_path {
        let body = fs::read_to_string(model_path).map_err(|error| {
            app_error(
                ErrorCode::StoryboardInferenceFailed,
                format!(
                    "Failed to read storyboard event model {}: {error}",
                    model_path.display()
                ),
            )
        })?;
        serde_json::from_str::<StoryboardDecisionConfig>(&body).map_err(|error| {
            app_error(
                ErrorCode::StoryboardInferenceFailed,
                format!(
                    "Failed to parse storyboard event model {}: {error}",
                    model_path.display()
                ),
            )
        })?
    } else {
        StoryboardDecisionConfig::default()
    };
    config.validate()?;
    Ok(config)
}

async fn run_storyboard_detection(
    StoryboardDetectionRequest {
        app,
        state,
        task_id,
        project,
        stream_index,
        preferences,
        runtime,
        cancel,
    }: StoryboardDetectionRequest<'_>,
) -> AppResult<StoryboardDetectionResult> {
    let started = std::time::Instant::now();
    let decision_config = storyboard_decision_config(runtime.event_model.as_ref())?;
    let frame_rate = storyboard_frame_rate(project);
    let expected_frames = expected_frame_count(project.asset.duration_us, frame_rate);
    ensure_not_cancelled(&cancel)?;
    let scheduler = STORYBOARD_EXTRACTION_SCHEDULER.get_or_init(|| {
        let physical_cores = storyboard_physical_cores();
        let core_limit = storyboard_core_limit(physical_cores, available_cpu_threads());
        tracing::info!(
            ?physical_cores,
            core_limit,
            "Configured storyboard total FFmpeg thread budget"
        );
        StoryboardExtractionScheduler::new(core_limit)
    });
    let extraction_slot = scheduler.acquire(&cancel).await?;
    let presentation_log = std::env::temp_dir().join(format!(
        "locution-storyboard-pts-{}-{}.txt",
        task_id,
        Uuid::new_v4()
    ));
    let _presentation_log_guard = PresentationLogGuard(presentation_log.clone());
    let child = spawn_storyboard_ffmpeg(
        project,
        stream_index,
        preferences,
        scheduler.threads,
        &presentation_log,
    )?;
    let process_id = Uuid::new_v4().to_string();
    let consumer = STORYBOARD_CONSUMER.get_or_init(|| Arc::new(StoryboardConsumer::default()));
    let (sender, queue) = consumer.queue();
    let process = Arc::new(StoryboardProcess {
        child: StdMutex::new(child),
        _slot: extraction_slot,
    });
    let extraction = StoryboardExtractionGuard {
        process: process.clone(),
        queue: queue.clone(),
        stop: Arc::new(AtomicBool::new(false)),
        state,
        process_id: process_id.clone(),
    };
    let (stdout, stderr, pid) = {
        let mut child = process
            .child
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let stdout = child.stdout.take().ok_or_else(|| {
            app_error(
                ErrorCode::ExternalToolOutputUnavailable,
                "FFmpeg did not expose a storyboard frame stream",
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            app_error(
                ErrorCode::ExternalToolOutputUnavailable,
                "FFmpeg did not expose storyboard diagnostics",
            )
        })?;
        (stdout, stderr, child.id())
    };
    register_running_ffmpeg(
        state,
        process_id.clone(),
        task_id.to_string(),
        cancel.clone(),
        Some(pid),
        Vec::new(),
    )?;
    let progress = StoryboardProgressReporter::new(app, task_id, expected_frames);
    let (inference, mut completion) =
        InferenceTask::new(task_id.to_string(), queue, cancel.clone(), Some(progress));
    let producer = StoryboardProducer {
        app: app.clone(),
        process,
        process_id,
        task_id: task_id.to_string(),
        cancel: cancel.clone(),
        stop: extraction.stop.clone(),
        sender,
    };
    std::thread::Builder::new()
        .name(format!("storyboard-decode-{task_id}"))
        .spawn(move || producer.run(stdout, stderr))
        .map_err(|error| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                format!("Failed to start storyboard producer: {error}"),
            )
        })?;
    consumer.submit(inference, runtime.clone())?;

    let (decoded_frames, predictions, provider) = loop {
        match tokio::time::timeout(pipeline::POLL_INTERVAL, &mut completion).await {
            Ok(result) => {
                break result.map_err(|_| {
                    app_error(
                        ErrorCode::BlockingTaskFailed,
                        "Storyboard consumer stopped before completing the task",
                    )
                })??;
            }
            Err(_) => ensure_not_cancelled(&cancel)?,
        }
    };
    ensure_not_cancelled(&cancel)?;
    drop(extraction);

    let pipeline_ms = started.elapsed().as_millis() as u64;
    let duration_us = project.asset.duration_us;
    let frame_times =
        load_presentation_timestamps(&presentation_log, predictions.single_frame.len());
    let time_source = if frame_times.is_some() {
        "presentation_timestamps"
    } else {
        tracing::warn!(
            task_id,
            decoded_frames,
            "Presentation timestamps did not align with decoded frames; shot times fall back to a constant frame rate"
        );
        "constant_frame_rate"
    };
    let (cuts, shots, decision_ms) =
        spawn_blocking_cancellable(cancel.clone(), "storyboard decision", move |cancel| {
            let started = std::time::Instant::now();
            let cuts = detect_storyboard_cuts(
                &predictions,
                frame_times.as_deref(),
                frame_rate,
                &decision_config,
            );
            ensure_not_cancelled(cancel)?;
            let shots = storyboard_cuts_to_shots(
                predictions.single_frame.len(),
                &cuts,
                frame_rate,
                duration_us,
                frame_times.as_deref(),
            );
            Ok((cuts, shots, started.elapsed().as_millis() as u64))
        })
        .await?;
    ensure_not_cancelled(&cancel)?;
    tracing::info!(
        task_id,
        provider,
        decoded_frames,
        time_source,
        pipeline_ms,
        decision_ms,
        total_ms = started.elapsed().as_millis() as u64,
        "Storyboard detection completed"
    );
    Ok(StoryboardDetectionResult {
        asset_id: project.asset.id.clone(),
        duration_us: project.asset.duration_us,
        frame_count: decoded_frames,
        frame_rate,
        provider,
        cuts,
        shots,
    })
}

fn spawn_storyboard_ffmpeg(
    project: &MediaDocument,
    stream_index: i32,
    preferences: &Preferences,
    threads: usize,
    presentation_log: &std::path::Path,
) -> AppResult<Child> {
    let args = storyboard_ffmpeg_args(&project.asset.path, stream_index, threads, presentation_log);
    tracing::info!(threads, "Configured storyboard FFmpeg extraction threads");
    let mut command = StdCommand::new(ffmpeg_program(preferences));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            app_error(
                ErrorCode::ExternalToolStartFailed,
                format!("Failed to start FFmpeg storyboard extraction: {error}"),
            )
        })
}

fn storyboard_ffmpeg_args(
    path: &str,
    stream_index: i32,
    threads: usize,
    presentation_log: &std::path::Path,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
    ];
    // Input-scoped -threads must precede -i to limit decoder parallelism.
    append_ffmpeg_processing_thread_args(&mut args, threads);
    // Leave hardware output format unset so FFmpeg transfers decoded frames
    // back to system memory for the existing software scale/RGB filter.
    #[cfg(windows)]
    args.extend(["-hwaccel".to_string(), "d3d11va".to_string()]);
    // TransNetV2 runs on CPU on macOS, so hardware decoding leaves it the cores.
    #[cfg(target_os = "macos")]
    args.extend(["-hwaccel".to_string(), "videotoolbox".to_string()]);
    args.extend([
        "-i".to_string(),
        path.to_string(),
        "-map".to_string(),
        format!("0:{stream_index}"),
        "-an".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
        "-vf".to_string(),
        format!(
            "scale={STORYBOARD_FRAME_WIDTH}:{STORYBOARD_FRAME_HEIGHT}:flags=bilinear,format=rgb24,metadata=mode=add:key=sb:value=1,metadata=mode=print:file='{}':direct=1",
            escape_ffmpeg_filter_value(&presentation_log.display().to_string())
        ),
        // FFmpeg 9 removed -vsync; -fps_mode (FFmpeg 5.1+) is the replacement.
        "-fps_mode".to_string(),
        "passthrough".to_string(),
    ]);
    // rawvideo supports frame threading, so bound its output workers too.
    append_ffmpeg_video_output_thread_args(&mut args, threads);
    args.extend([
        "-f".to_string(),
        "rawvideo".to_string(),
        "pipe:1".to_string(),
    ]);
    args
}

struct PresentationLogGuard(std::path::PathBuf);

impl Drop for PresentationLogGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn escape_ffmpeg_filter_value(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '\'' | ':' | ',' | '[' | ']' | ';') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn load_presentation_timestamps(path: &std::path::Path, frame_count: usize) -> Option<Vec<i64>> {
    let body = fs::read_to_string(path).ok()?;
    parse_storyboard_presentation_timestamps(&body, frame_count)
}

fn parse_storyboard_presentation_timestamps(body: &str, frame_count: usize) -> Option<Vec<i64>> {
    if frame_count == 0 {
        return None;
    }
    let mut times = Vec::with_capacity(frame_count);
    for line in body.lines() {
        let line = line.trim();
        if !line.starts_with("frame:") {
            continue;
        }
        let mut parts = line.split_whitespace();
        let frame_index = parts
            .next()?
            .strip_prefix("frame:")?
            .parse::<usize>()
            .ok()?;
        if frame_index != times.len() {
            return None;
        }
        let pts = parts.next()?.strip_prefix("pts:")?;
        let pts_time = parts.next()?.strip_prefix("pts_time:")?;
        if pts.eq_ignore_ascii_case("N/A") || pts_time.eq_ignore_ascii_case("N/A") {
            return None;
        }
        let seconds = pts_time.parse::<f64>().ok()?;
        if !seconds.is_finite() || seconds < 0.0 {
            return None;
        }
        let micros = (seconds * 1_000_000.0).round();
        if !micros.is_finite() || micros > i64::MAX as f64 {
            return None;
        }
        let micros = micros as i64;
        if times.last().is_some_and(|previous| micros <= *previous) {
            return None;
        }
        times.push(micros);
    }
    (times.len() == frame_count).then_some(times)
}

fn read_storyboard_frame<R: Read>(reader: &mut R, frame: &mut [u8]) -> AppResult<bool> {
    let mut filled = 0usize;
    while filled < frame.len() {
        let read = match reader.read(&mut frame[filled..]) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result.map_err(|error| {
                app_error(
                    ErrorCode::StoryboardFrameDecodeFailed,
                    format!("Failed to read storyboard frame bytes: {error}"),
                )
            })?,
        };
        if read == 0 {
            if filled == 0 {
                return Ok(false);
            }
            return Err(app_error(
                ErrorCode::StoryboardFrameDecodeFailed,
                format!(
                    "FFmpeg ended in the middle of a storyboard frame: read {filled}/{} bytes",
                    frame.len()
                ),
            ));
        }
        filled += read;
    }
    Ok(true)
}

fn produce_storyboard_blocks<R: Read>(
    mut reader: R,
    sender: &FrameSender,
    task_id: &str,
    cancel: &AtomicBool,
    stop: &AtomicBool,
) -> AppResult<()> {
    let mut read_time = Duration::ZERO;
    let mut queue_wait = Duration::ZERO;
    let mut decoded_frames = 0;
    loop {
        let read_started = std::time::Instant::now();
        let mut frames = Vec::with_capacity(TRANSNET_STRIDE_FRAMES);
        for _ in 0..TRANSNET_STRIDE_FRAMES {
            ensure_not_cancelled(cancel)?;
            ensure_not_cancelled(stop)?;
            let mut frame = vec![0; STORYBOARD_FRAME_BYTES];
            if !read_storyboard_frame(&mut reader, &mut frame)? {
                break;
            }
            frames.push(frame);
        }
        read_time += read_started.elapsed();
        decoded_frames += frames.len();
        let last_block = frames.len() < TRANSNET_STRIDE_FRAMES;
        if !frames.is_empty() {
            // Blocking send supplies backpressure; closing only this task's
            // receiver wakes it immediately, even while the model is busy.
            let send_started = std::time::Instant::now();
            sender
                .send(ProducerMessage::Frames(FrameBlock {
                    task_id: task_id.to_string(),
                    frames,
                }))
                .map_err(|_| {
                    app_error(
                        ErrorCode::TaskCancelled,
                        "Storyboard frame queue was closed",
                    )
                })?;
            queue_wait += send_started.elapsed();
        }
        if last_block {
            tracing::info!(
                task_id,
                decoded_frames,
                read_ms = read_time.as_millis() as u64,
                queue_wait_ms = queue_wait.as_millis() as u64,
                "Storyboard frame stream completed"
            );
            return Ok(());
        }
    }
}

struct StoryboardProcess {
    child: StdMutex<Child>,
    // Release admission only after Drop has killed and reaped the process.
    _slot: tokio::sync::SemaphorePermit<'static>,
}

impl Drop for StoryboardProcess {
    fn drop(&mut self) {
        // std::process::Child has no kill-on-drop behavior. This also covers
        // failed thread creation and a producer panic before normal cleanup.
        let child = self
            .child
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        let _ = child.kill();
        let _ = child.wait();
    }
}

struct StoryboardProducer {
    app: tauri::AppHandle,
    process: Arc<StoryboardProcess>,
    process_id: String,
    task_id: String,
    cancel: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    sender: FrameSender,
}

impl StoryboardProducer {
    fn run(self, stdout: std::process::ChildStdout, stderr: std::process::ChildStderr) {
        let result = self.extract(stdout, stderr);
        clear_running_ffmpeg(self.app.state::<AppState>().inner(), &self.process_id);
        let _ = self.sender.send(ProducerMessage::Finished(result));
    }

    fn extract(
        &self,
        stdout: std::process::ChildStdout,
        stderr: std::process::ChildStderr,
    ) -> AppResult<()> {
        let diagnostics = std::thread::Builder::new()
            .name("storyboard-diagnostics".into())
            .spawn(move || {
                let mut body = String::new();
                let _ = BufReader::new(stderr).read_to_string(&mut body);
                body
            })
            .map_err(|error| {
                app_error(
                    ErrorCode::BlockingTaskFailed,
                    format!("Failed to start storyboard diagnostic reader: {error}"),
                )
            })?;
        let decoded = produce_storyboard_blocks(
            BufReader::new(stdout),
            &self.sender,
            &self.task_id,
            &self.cancel,
            &self.stop,
        );
        let status =
            wait_storyboard_extraction(&self.process, &self.cancel, &self.stop, decoded.is_err());
        let stderr = diagnostics.join().map_err(|_| {
            app_error(
                ErrorCode::BlockingTaskFailed,
                "Storyboard diagnostic reader panicked",
            )
        });
        ensure_not_cancelled(&self.cancel)?;
        decoded?;
        let status = status?;
        let stderr = stderr?;
        if status.success() {
            Ok(())
        } else {
            Err(app_error(
                ErrorCode::ExternalToolExecutionFailed,
                format!("FFmpeg storyboard extraction exited unsuccessfully; stderr={stderr}"),
            ))
        }
    }
}

struct StoryboardExtractionGuard<'a> {
    process: Arc<StoryboardProcess>,
    queue: Arc<FrameQueue>,
    stop: Arc<AtomicBool>,
    state: &'a AppState,
    process_id: String,
}

impl Drop for StoryboardExtractionGuard<'_> {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.queue.close();
        let _ = self
            .process
            .child
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .kill();
        clear_running_ffmpeg(self.state, &self.process_id);
    }
}

fn wait_storyboard_extraction(
    process: &StoryboardProcess,
    cancel: &AtomicBool,
    stop: &AtomicBool,
    failed: bool,
) -> AppResult<std::process::ExitStatus> {
    loop {
        {
            let mut child = process
                .child
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if failed || cancel.load(Ordering::SeqCst) || stop.load(Ordering::SeqCst) {
                let _ = child.kill();
            }
            match child.try_wait() {
                Ok(Some(status)) => return Ok(status),
                Ok(None) => {}
                Err(error) => {
                    // Do not leave the diagnostic reader waiting on a child
                    // after an error querying its exit status.
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(app_error(
                        ErrorCode::ExternalToolWaitFailed,
                        format!("Failed to wait for FFmpeg storyboard extraction: {error}"),
                    ));
                }
            }
        }
        std::thread::sleep(pipeline::POLL_INTERVAL);
    }
}

struct TransnetSession {
    session: OnnxModel,
    input: Tensor<f32>,
    options: RunOptions<HasSelectedOutputs>,
    windows: usize,
    packing_time: Duration,
    inference_time: Duration,
}

impl TransnetSession {
    fn new(session: OnnxModel) -> AppResult<Self> {
        let input = Tensor::<f32>::from_array((
            [
                1,
                TRANSNET_WINDOW_FRAMES,
                STORYBOARD_FRAME_HEIGHT,
                STORYBOARD_FRAME_WIDTH,
                STORYBOARD_FRAME_CHANNELS,
            ],
            vec![0.0; TRANSNET_WINDOW_FRAMES * STORYBOARD_FRAME_BYTES],
        ))
        .map_err(|error| storyboard_ort_error("create TransNetV2 input tensor", error))?;
        session.run(None, |session| {
            let names = session
                .outputs
                .iter()
                .map(|output| output.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            let single = session
                .outputs
                .iter()
                .find(|output| output.name == TRANSNET_SINGLE_FRAME_OUTPUT);
            let many = session
                .outputs
                .iter()
                .find(|output| output.name == TRANSNET_MANY_HOT_OUTPUT);
            let (Some(single), Some(many)) = (single, many) else {
                return Err(ort::Error::new(format!(
                    "TransNetV2 outputs [{names}] do not include {TRANSNET_SINGLE_FRAME_OUTPUT} and {TRANSNET_MANY_HOT_OUTPUT}"
                )));
            };
            for output in [single, many] {
                match &output.output_type {
                    ort::value::ValueType::Tensor { dimensions, .. }
                        if dimensions.as_slice() == TRANSNET_OUTPUT_SHAPE => {}
                    _ => {
                        return Err(ort::Error::new(format!(
                            "TransNetV2 output {} must be a float tensor shaped [1, {TRANSNET_WINDOW_FRAMES}, 1]",
                            output.name
                        )));
                    }
                }
            }
            Ok(())
        })?;
        // Request both heads. Model order is single-frame then many-hot, and
        // the selector lists them in that same order.
        let options = RunOptions::new()
            .map_err(|error| storyboard_ort_error("create TransNetV2 run options", error))?
            .with_outputs(
                OutputSelector::no_default()
                    .with(TRANSNET_SINGLE_FRAME_OUTPUT)
                    .with(TRANSNET_MANY_HOT_OUTPUT),
            );
        Ok(Self {
            session,
            input,
            options,
            windows: 0,
            packing_time: Duration::ZERO,
            inference_time: Duration::ZERO,
        })
    }
}

impl Drop for TransnetSession {
    fn drop(&mut self) {
        tracing::info!(
            windows = self.windows,
            packing_ms = self.packing_time.as_millis() as u64,
            inference_ms = self.inference_time.as_millis() as u64,
            "Storyboard inference session retired"
        );
    }
}

fn fill_transnet_input(input: &mut [f32], window: &VecDeque<Vec<u8>>) -> AppResult<()> {
    if window.len() < TRANSNET_WINDOW_FRAMES
        || window
            .iter()
            .take(TRANSNET_WINDOW_FRAMES)
            .any(|frame| frame.len() != STORYBOARD_FRAME_BYTES)
        || input.len() != TRANSNET_WINDOW_FRAMES * STORYBOARD_FRAME_BYTES
    {
        return Err(app_error(
            ErrorCode::StoryboardInferenceFailed,
            "Invalid TransNetV2 frame window",
        ));
    }
    for (target, frame) in input.chunks_exact_mut(STORYBOARD_FRAME_BYTES).zip(window) {
        for (target, value) in target.iter_mut().zip(frame) {
            *target = *value as f32;
        }
    }
    Ok(())
}

fn center_head_probabilities(values: &[f32], head: &str) -> ort::Result<Vec<f32>> {
    if values.len() < TRANSNET_CENTER_END {
        return Err(ort::Error::new(format!(
            "TransNetV2 {head} output is too short: {} values, expected at least {TRANSNET_CENTER_END}",
            values.len()
        )));
    }
    let center = &values[TRANSNET_CENTER_START..TRANSNET_CENTER_END];
    let needs_sigmoid = center.iter().any(|value| *value < 0.0 || *value > 1.0);
    Ok(center
        .iter()
        .map(|value| {
            if needs_sigmoid {
                1.0 / (1.0 + (-*value).exp())
            } else {
                value.clamp(0.0, 1.0)
            }
        })
        .collect())
}

fn run_transnet_window(
    model: &mut TransnetSession,
    window: &VecDeque<Vec<u8>>,
    cancel: &AtomicBool,
) -> AppResult<TransnetPredictions> {
    let packing_started = std::time::Instant::now();
    let (_, input) = model
        .input
        .try_extract_raw_tensor_mut::<f32>()
        .map_err(|error| storyboard_ort_error("access TransNetV2 input tensor", error))?;
    fill_transnet_input(input, window)?;
    model.packing_time += packing_started.elapsed();
    let inference_started = std::time::Instant::now();
    let predictions = model.session.run(Some(cancel), |session| {
        let outputs = session.run_with_options([model.input.view().into()], &model.options)?;
        if outputs.len() != 2 {
            return Err(ort::Error::new(format!(
                "TransNetV2 produced {} outputs, expected the single-frame and many-hot heads",
                outputs.len()
            )));
        }
        let (_, single_frame) = outputs[0].try_extract_raw_tensor::<f32>()?;
        let (_, many_hot) = outputs[1].try_extract_raw_tensor::<f32>()?;
        Ok(TransnetPredictions {
            single_frame: center_head_probabilities(single_frame, TRANSNET_SINGLE_FRAME_OUTPUT)?,
            many_hot: center_head_probabilities(many_hot, TRANSNET_MANY_HOT_OUTPUT)?,
        })
    })?;
    model.inference_time += inference_started.elapsed();
    model.windows += 1;
    Ok(predictions)
}

struct StoryboardProgressReporter {
    app: tauri::AppHandle,
    task_id: String,
    expected_frames: usize,
    last_progress: f64,
    last_predicted_frames: usize,
}

impl StoryboardProgressReporter {
    fn new(app: &tauri::AppHandle, task_id: &str, expected_frames: usize) -> Self {
        Self {
            app: app.clone(),
            task_id: task_id.to_string(),
            expected_frames,
            last_progress: 0.0,
            last_predicted_frames: 0,
        }
    }

    fn report_predicted(&mut self, predicted_frames: usize, known_frames: usize) {
        if !Self::should_report_frames(self.last_predicted_frames, predicted_frames) {
            return;
        }
        self.last_predicted_frames = predicted_frames;
        let denominator = self.frame_denominator(known_frames.max(predicted_frames));
        self.emit(
            (predicted_frames as f64 / denominator as f64).clamp(0.0, 1.0)
                * STORYBOARD_PROGRESS_PREDICT_END,
            false,
        );
    }

    fn report_prediction_complete(&mut self) {
        self.emit(STORYBOARD_PROGRESS_PREDICT_END, true);
    }

    fn frame_denominator(&self, observed_frames: usize) -> usize {
        if self.expected_frames > 0 {
            return self.expected_frames.max(observed_frames).max(1);
        }
        observed_frames
            .saturating_add(TRANSNET_WINDOW_FRAMES * 8)
            .max(1)
    }

    fn should_report_frames(previous: usize, current: usize) -> bool {
        current > previous
            && current.saturating_sub(previous) >= STORYBOARD_PROGRESS_FRAME_REPORT_INTERVAL
    }

    fn emit(&mut self, progress: f64, force: bool) {
        let progress = progress.clamp(0.0, STORYBOARD_PROGRESS_PREDICT_END);
        if progress <= self.last_progress {
            return;
        }
        if force || progress - self.last_progress >= STORYBOARD_PROGRESS_MIN_DELTA {
            self.last_progress = progress;
            emit_ffmpeg_progress(&self.app, &self.task_id, progress);
        }
    }
}

fn storyboard_frame_rate(project: &MediaDocument) -> f64 {
    let stream = project
        .streams
        .iter()
        .find(|stream| Some(stream.index) == project.asset.video_stream_index)
        .or_else(|| {
            project
                .streams
                .iter()
                .find(|stream| stream.codec_type == "video")
        });
    stream
        .and_then(|stream| {
            parse_frame_rate(stream.avg_frame_rate.as_deref())
                .or_else(|| parse_frame_rate(stream.r_frame_rate.as_deref()))
        })
        .unwrap_or(DEFAULT_MEDIA_FRAME_RATE)
}

pub(crate) fn parse_frame_rate(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() || value == "0/0" {
        return None;
    }
    if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator = numerator.parse::<f64>().ok()?;
        let denominator = denominator.parse::<f64>().ok()?;
        if denominator <= 0.0 {
            return None;
        }
        let rate = numerator / denominator;
        return (rate.is_finite() && rate > 0.0).then_some(rate);
    }
    let rate = value.parse::<f64>().ok()?;
    (rate.is_finite() && rate > 0.0).then_some(rate)
}

fn expected_frame_count(duration_us: i64, frame_rate: f64) -> usize {
    if duration_us <= 0 || !frame_rate.is_finite() || frame_rate <= 0.0 {
        return 0;
    }
    ((duration_us as f64 / 1_000_000.0) * frame_rate).ceil() as usize
}

fn raw_frame_time_us(
    frame: usize,
    frame_count: usize,
    frame_times_us: Option<&[i64]>,
    frame_rate: f64,
) -> i64 {
    frame_times_us
        .filter(|times| times.len() == frame_count)
        .and_then(|times| times.get(frame).copied())
        .unwrap_or_else(|| synthetic_frame_time_us(frame, frame_rate))
}

fn storyboard_cuts_to_shots(
    frame_count: usize,
    cuts: &[StoryboardCut],
    frame_rate: f64,
    duration_us: i64,
    frame_times_us: Option<&[i64]>,
) -> Vec<StoryboardShot> {
    if frame_count == 0 {
        return Vec::new();
    }

    let mut raw_ranges = Vec::<(usize, usize)>::new();
    let mut start = 0usize;
    for cut in cuts {
        if cut.cut_frame < start || cut.cut_frame >= frame_count.saturating_sub(1) {
            continue;
        }
        raw_ranges.push((start, cut.cut_frame));
        start = cut.cut_frame + 1;
    }
    if start < frame_count {
        raw_ranges.push((start, frame_count - 1));
    }

    let duration_us = duration_us.max(0);
    let final_range_index = raw_ranges.len().saturating_sub(1);
    raw_ranges
        .into_iter()
        .enumerate()
        .map(|(index, (start_frame, end_frame))| {
            let start_us = raw_frame_time_us(start_frame, frame_count, frame_times_us, frame_rate)
                .clamp(0, duration_us);
            // Non-final shots end at the next frame's presentation time, which
            // is also the next shot's start. The last shot ends at the media
            // duration. Missing or misaligned timestamps use a constant rate.
            let end_us = if index == final_range_index {
                duration_us.max(start_us)
            } else {
                raw_frame_time_us(end_frame + 1, frame_count, frame_times_us, frame_rate)
                    .clamp(start_us, duration_us.max(start_us))
            };
            StoryboardShot {
                id: format!("shot:{start_frame}:{end_frame}"),
                sequence: index + 1,
                start_frame,
                end_frame,
                start_us,
                end_us,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extraction_budget_counts_physical_cores_and_respects_process_limits() {
        for (physical, available, expected) in [
            (Some(16), 22, 16),
            (Some(8), 16, 8),
            (Some(16), 4, 4),
            (Some(1), 2, 1),
            (None, 22, 1),
            (Some(0), 22, 1),
            (Some(16), 0, 1),
        ] {
            let limit = storyboard_core_limit(physical, available);
            assert_eq!(limit, expected);
            let scheduler = StoryboardExtractionScheduler::new(limit);
            assert!(scheduler.slots.available_permits() * scheduler.threads <= expected);
        }
        let scheduler = StoryboardExtractionScheduler::new(storyboard_core_limit(Some(16), 22));
        assert_eq!(scheduler.threads, 5);
        assert_eq!(scheduler.slots.available_permits(), 3);
    }

    #[test]
    #[cfg(windows)]
    fn windows_reports_physical_core_topology() {
        let cores = storyboard_physical_cores().expect("Windows must report processor cores");
        assert!(cores > 0);
        eprintln!("Detected physical CPU cores: {cores}");
    }

    #[test]
    fn concurrent_extraction_thread_totals_stay_within_cpu_budget() {
        for available in 1..=256 {
            let scheduler = StoryboardExtractionScheduler::new(available);
            let mut running = Vec::new();
            while let Ok(permit) = scheduler.slots.try_acquire() {
                running.push(permit);
            }
            assert_eq!(running.len(), available.min(3));
            assert!(running.len() * scheduler.threads <= available);
            assert!((1..=16).contains(&scheduler.threads));
            assert!(scheduler.slots.try_acquire().is_err());
            running.pop();
            let replacement = scheduler.slots.try_acquire().unwrap();
            assert!(scheduler.slots.try_acquire().is_err());
            drop(replacement);
        }
        assert_eq!(StoryboardExtractionScheduler::new(22).threads, 7);
        assert_eq!(StoryboardExtractionScheduler::new(0).threads, 1);
    }

    #[test]
    fn waiting_for_extraction_capacity_can_be_cancelled_and_retried() {
        let scheduler = StoryboardExtractionScheduler::new(1);
        let held = scheduler.slots.try_acquire().unwrap();
        let cancel = AtomicBool::new(false);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let waiting = scheduler.acquire(&cancel);
            tokio::pin!(waiting);
            assert!(
                tokio::time::timeout(Duration::from_millis(10), &mut waiting)
                    .await
                    .is_err(),
                "extraction started without a free slot"
            );
            cancel.store(true, Ordering::SeqCst);
            assert!(tokio::time::timeout(Duration::from_secs(1), &mut waiting)
                .await
                .unwrap()
                .is_err());
        });
        assert_eq!(scheduler.slots.available_permits(), 0);
        drop(held);
        cancel.store(false, Ordering::SeqCst);
        let retry = runtime.block_on(scheduler.acquire(&cancel)).unwrap();
        assert_eq!(scheduler.slots.available_permits(), 0);
        drop(retry);
        assert_eq!(scheduler.slots.available_permits(), 1);
    }

    #[test]
    fn extraction_args_scope_hardware_decode_and_threads_to_the_input() {
        let path = "D:\\media files\\input.mp4";
        let scheduler = StoryboardExtractionScheduler::new(storyboard_core_limit(Some(16), 22));
        let presentation_log = PathBuf::from("C:/storyboard pts/log.txt");
        let args = storyboard_ffmpeg_args(path, 2, scheduler.threads, &presentation_log);
        let value = |option: &str| {
            let index = args.iter().position(|arg| arg == option).unwrap();
            (index, args[index + 1].as_str())
        };
        let (input, input_path) = value("-i");
        assert_eq!(input_path, path);
        for option in ["-threads", "-filter_threads", "-filter_complex_threads"] {
            let (index, threads) = value(option);
            assert!(index < input);
            assert_eq!(threads, "5");
        }
        #[cfg(windows)]
        {
            let (index, accelerator) = value("-hwaccel");
            assert!(index < input);
            assert_eq!(accelerator, "d3d11va");
        }
        #[cfg(target_os = "macos")]
        {
            let (index, accelerator) = value("-hwaccel");
            assert!(index < input);
            assert_eq!(accelerator, "videotoolbox");
        }
        assert!(!args.iter().any(|arg| arg == "-hwaccel_output_format"));
        let (output, threads) = value("-threads:v");
        assert!(output > input);
        assert_eq!(threads, "5");
        assert_eq!(value("-map").1, "0:2");
        assert_eq!(
            value("-vf").1,
            "scale=48:27:flags=bilinear,format=rgb24,metadata=mode=add:key=sb:value=1,metadata=mode=print:file='C\\:/storyboard pts/log.txt':direct=1"
        );
        assert_eq!(value("-fps_mode").1, "passthrough");
        assert_eq!(value("-f").1, "rawvideo");
        assert_eq!(args.last().unwrap(), "pipe:1");
    }

    #[test]
    fn packaged_storyboard_event_model_is_valid() {
        let model_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(TRANSNET_RESOURCE_DIR)
            .join(STORYBOARD_EVENT_MODEL_FILE);

        let config =
            storyboard_decision_config(Some(&model_path)).expect("packaged model must be valid");

        assert_eq!(config.model_origin, "threshold_rules_uncalibrated");
        assert_eq!(config.single_frame_threshold, 0.5);
        assert_eq!(config.many_hot_threshold, 0.5);
        assert_eq!(config.minimum_event_gap_seconds, 0.12);
    }

    #[test]
    #[ignore = "requires packaged TransNetV2 and ONNX Runtime assets; run manually"]
    fn packaged_transnet_model_loads_with_cpu_provider() {
        let runtime_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(TRANSNET_RESOURCE_DIR);
        let onnxruntime = runtime_dir
            .join(ONNXRUNTIME_DLL_FILE)
            .to_string_lossy()
            .into_owned();

        configure_dll_search(&runtime_dir).expect("packaged DLL directory must be available");
        ort::init_from(onnxruntime)
            .with_name("locution-pro-transnetv2-cpu-test")
            .with_telemetry(false)
            .commit()
            .expect("packaged ONNX Runtime must initialize");

        let session = create_cpu_model_session(&runtime_dir.join(TRANSNET_MODEL_FILE))
            .expect("packaged model must load with the CPU provider");
        assert_transnet_reuse_matches_fresh_tensors(session);
    }

    fn assert_transnet_reuse_matches_fresh_tensors(session: Session) {
        let mut model = TransnetSession::new(OnnxModel::from_session(session, |detail| {
            app_error(ErrorCode::StoryboardInferenceFailed, detail)
        }))
        .unwrap();
        let input_address = model.input.extract_raw_tensor().1.as_ptr();
        // Exercise unrelated windows as the shared session would when tasks
        // alternate. Compare with the former fresh-tensor, all-output path.
        for marker in [3usize, 173, 3] {
            let window = (0..TRANSNET_WINDOW_FRAMES)
                .map(|frame| {
                    (0..STORYBOARD_FRAME_BYTES)
                        .map(|pixel| ((pixel * 7 + frame * 11 + marker) % 256) as u8)
                        .collect::<Vec<_>>()
                })
                .collect::<VecDeque<_>>();
            let tensor = Tensor::<f32>::from_array((
                [
                    1,
                    TRANSNET_WINDOW_FRAMES,
                    STORYBOARD_FRAME_HEIGHT,
                    STORYBOARD_FRAME_WIDTH,
                    STORYBOARD_FRAME_CHANNELS,
                ],
                window
                    .iter()
                    .flatten()
                    .map(|value| *value as f32)
                    .collect::<Vec<_>>(),
            ))
            .unwrap();
            let expected = model
                .session
                .run(None, |session| {
                    let outputs = session.run([tensor.view().into()])?;
                    let (_, single_frame) = outputs[0].try_extract_raw_tensor::<f32>().unwrap();
                    let (_, many_hot) = outputs[1].try_extract_raw_tensor::<f32>().unwrap();
                    Ok(TransnetPredictions {
                        single_frame: center_head_probabilities(
                            single_frame,
                            TRANSNET_SINGLE_FRAME_OUTPUT,
                        )
                        .unwrap(),
                        many_hot: center_head_probabilities(many_hot, TRANSNET_MANY_HOT_OUTPUT)
                            .unwrap(),
                    })
                })
                .unwrap();
            assert_eq!(
                run_transnet_window(&mut model, &window, &AtomicBool::new(false)).unwrap(),
                expected
            );
            assert_eq!(model.input.extract_raw_tensor().1.as_ptr(), input_address);
        }
    }

    #[test]
    fn cpu_inference_budget_reserves_capacity_and_has_a_ceiling() {
        for (available, expected) in [(0, 1), (1, 1), (2, 1), (4, 2), (8, 4), (16, 8), (64, 8)] {
            assert_eq!(storyboard_cpu_thread_budget(available), expected);
        }
    }

    #[test]
    fn reusable_input_preserves_layout_and_rejects_incomplete_windows() {
        let mut input = vec![0.0; TRANSNET_WINDOW_FRAMES * STORYBOARD_FRAME_BYTES];
        let mut window = (0..TRANSNET_WINDOW_FRAMES)
            .map(|frame| vec![frame as u8; STORYBOARD_FRAME_BYTES])
            .collect::<VecDeque<_>>();
        // Wrap the deque so tests also cover discontiguous storage.
        for _ in 0..37 {
            let frame = window.pop_front().unwrap();
            window.push_back(frame);
        }
        fill_transnet_input(&mut input, &window).unwrap();
        assert_eq!(
            input,
            window
                .iter()
                .flatten()
                .map(|value| *value as f32)
                .collect::<Vec<_>>()
        );
        window.pop_back();
        assert!(fill_transnet_input(&mut input, &window).is_err());
    }

    #[test]
    #[ignore = "requires a DirectX 12 adapter (Windows) or CoreML (macOS); run manually before releases"]
    fn packaged_transnet_model_loads_with_gpu_provider() {
        let runtime_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(TRANSNET_RESOURCE_DIR);
        let onnxruntime = runtime_dir
            .join(ONNXRUNTIME_DLL_FILE)
            .to_string_lossy()
            .into_owned();

        configure_dll_search(&runtime_dir).expect("packaged DLL directory must be available");
        ort::init_from(onnxruntime)
            .with_name("locution-pro-transnetv2-directml-test")
            .with_telemetry(false)
            .commit()
            .expect("packaged ONNX Runtime must initialize");

        let session =
            create_gpu_model_session_with_dimensions(&runtime_dir.join(TRANSNET_MODEL_FILE), &[])
                .expect("packaged model must load with the platform GPU provider");
        assert_transnet_reuse_matches_fresh_tensors(session);
    }

    fn single_predictions(values: Vec<f32>) -> TransnetPredictions {
        TransnetPredictions {
            single_frame: values,
            many_hot: Vec::new(),
        }
    }

    #[test]
    fn storyboard_predictions_split_at_isolated_event_peak() {
        let mut predictions = vec![0.01; 120];
        predictions[60] = 0.8;
        let predictions = single_predictions(predictions);

        let cuts = detect_storyboard_cuts(
            &predictions,
            None,
            25.0,
            &StoryboardDecisionConfig::default(),
        );
        let shots =
            storyboard_cuts_to_shots(predictions.single_frame.len(), &cuts, 25.0, 4_800_000, None);

        assert_eq!(shots.len(), 2);
        assert_eq!(shots[0].start_frame, 0);
        assert_eq!(shots[0].end_frame, 60);
        assert_eq!(shots[1].start_frame, 61);
        assert_eq!(shots[1].end_frame, 119);
    }

    #[test]
    fn storyboard_predictions_merge_contiguous_peak_frames() {
        let mut predictions = vec![0.01; 100];
        predictions[40] = 0.9;
        predictions[41] = 0.95;
        predictions[42] = 0.92;

        let predictions = single_predictions(predictions);
        let cuts = detect_storyboard_cuts(
            &predictions,
            None,
            25.0,
            &StoryboardDecisionConfig::default(),
        );
        let shots =
            storyboard_cuts_to_shots(predictions.single_frame.len(), &cuts, 25.0, 4_000_000, None);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].cut_frame, 41);
        assert_eq!(shots.len(), 2);
        assert_eq!(shots[0].start_frame, 0);
        assert_eq!(shots[0].end_frame, 41);
        assert_eq!(shots[1].start_frame, 42);
        assert_eq!(shots[1].end_frame, 99);
    }

    #[test]
    fn storyboard_shots_do_not_overlap() {
        let cuts = vec![
            StoryboardCut {
                cut_frame: 40,
                confidence: 0.9,
                event_start: 40,
                event_end: 40,
                peak_probability: 0.9,
                robust_prominence: 10.0,
                event_area: 0.9,
                event_width: 1,
            },
            StoryboardCut {
                cut_frame: 45,
                confidence: 0.8,
                event_start: 45,
                event_end: 45,
                peak_probability: 0.8,
                robust_prominence: 8.0,
                event_area: 0.8,
                event_width: 1,
            },
        ];

        let shots = storyboard_cuts_to_shots(100, &cuts, 25.0, 4_000_000, None);

        assert_eq!(shots.len(), 3);
        assert_eq!(shots[0].end_frame + 1, shots[1].start_frame);
        assert_eq!(shots[1].end_frame + 1, shots[2].start_frame);
        assert_eq!(shots[0].end_frame, 40);
        assert_eq!(shots[1].start_frame, 41);
        assert_eq!(shots[1].end_frame, 45);
        assert_eq!(shots[0].end_us, synthetic_frame_time_us(41, 25.0));
        assert_eq!(shots[0].end_us, shots[1].start_us);
        assert_eq!(shots[1].end_us, synthetic_frame_time_us(46, 25.0));
        assert_eq!(shots[1].end_us, shots[2].start_us);
        assert_eq!(shots[2].end_us, 4_000_000);
        assert_eq!(shots[1].start_us - shots[0].end_us, 0);
    }

    #[test]
    fn storyboard_single_frame_shot_meets_the_next_shot() {
        let cuts = vec![StoryboardCut {
            cut_frame: 0,
            confidence: 0.9,
            event_start: 0,
            event_end: 0,
            peak_probability: 0.9,
            robust_prominence: 10.0,
            event_area: 0.9,
            event_width: 1,
        }];

        let shots = storyboard_cuts_to_shots(10, &cuts, 25.0, 400_000, None);

        assert_eq!(shots[0].start_frame, 0);
        assert_eq!(shots[0].end_frame, 0);
        assert_eq!(shots[0].start_us, 0);
        assert_eq!(shots[0].end_us, synthetic_frame_time_us(1, 25.0));
        assert_eq!(shots[0].end_us, shots[1].start_us);
        assert_eq!(shots[1].end_us, 400_000);
    }

    #[test]
    fn storyboard_predictions_allow_short_edge_shot() {
        let mut predictions = vec![0.01; 100];
        predictions[5] = 0.95;

        let predictions = single_predictions(predictions);
        let cuts = detect_storyboard_cuts(
            &predictions,
            None,
            25.0,
            &StoryboardDecisionConfig::default(),
        );
        let shots =
            storyboard_cuts_to_shots(predictions.single_frame.len(), &cuts, 25.0, 4_000_000, None);

        assert_eq!(shots.len(), 2);
        assert_eq!(shots[0].start_frame, 0);
        assert_eq!(shots[0].end_frame, 5);
        assert_eq!(shots[1].start_frame, 6);
        assert_eq!(shots[1].end_frame, 99);
    }

    #[test]
    fn shot_ranges_follow_presentation_timestamps_without_a_frame_gap() {
        let cuts = vec![StoryboardCut {
            cut_frame: 2,
            confidence: 0.9,
            event_start: 2,
            event_end: 3,
            peak_probability: 0.9,
            robust_prominence: 8.0,
            event_area: 1.4,
            event_width: 2,
        }];
        let times = vec![0, 10_000, 80_000, 90_000, 250_000, 400_000];

        let shots = storyboard_cuts_to_shots(times.len(), &cuts, 25.0, 1_000_000, Some(&times));

        assert_eq!(shots.len(), 2);
        assert_eq!(shots[0].start_frame, 0);
        assert_eq!(shots[0].end_frame, 2);
        assert_eq!(shots[0].start_us, times[0]);
        assert_eq!(shots[0].end_us, times[3]);
        assert_eq!(shots[1].start_frame, 3);
        assert_eq!(shots[1].start_us, times[3]);
        assert_eq!(shots[0].end_us, shots[1].start_us);
        assert_eq!(shots[1].end_frame, 5);
        assert_eq!(shots[1].end_us, 1_000_000);
    }

    #[test]
    fn missing_presentation_timestamps_fall_back_to_a_closed_constant_rate() {
        let cuts = vec![StoryboardCut {
            cut_frame: 40,
            confidence: 0.9,
            event_start: 40,
            event_end: 40,
            peak_probability: 0.9,
            robust_prominence: 8.0,
            event_area: 0.9,
            event_width: 1,
        }];

        let missing = storyboard_cuts_to_shots(100, &cuts, 25.0, 4_000_000, None);
        let short = storyboard_cuts_to_shots(100, &cuts, 25.0, 4_000_000, Some(&[0, 40_000]));
        let parsed = parse_storyboard_presentation_timestamps(
            "frame:0 pts:0 pts_time:N/A\nframe:1 pts:1 pts_time:0.04\n",
            2,
        );

        assert!(parsed.is_none());
        assert_eq!(missing, short);
        assert_eq!(missing[0].end_us, missing[1].start_us);
        assert_eq!(missing[0].end_us, synthetic_frame_time_us(41, 25.0));
        assert_eq!(missing[1].end_us, 4_000_000);
        assert!(parse_storyboard_presentation_timestamps(
            "\
frame:0    pts:0       pts_time:0
sb=1
frame:1    pts:512     pts_time:0.021333
sb=1
frame:2    pts:1536    pts_time:0.064
",
            3,
        )
        .is_some_and(|times| times == vec![0, 21_333, 64_000]));
        assert!(parse_storyboard_presentation_timestamps(
            "frame:0 pts:0 pts_time:0.2\nframe:1 pts:1 pts_time:0.1\n",
            2,
        )
        .is_none());
    }

    fn media_with_video_rate(avg: Option<&str>, real: Option<&str>) -> MediaDocument {
        serde_json::from_value(serde_json::json!({
            "asset": {
                "id": "asset",
                "path": "clip.mp4",
                "file_name": "clip.mp4",
                "file_size": 1,
                "modified_at": 0,
                "fingerprint": "hash",
                "duration_us": 1_000_000,
                "start_time_us": 0,
                "video_stream_index": 0,
                "audio_stream_index": null
            },
            "streams": [{
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "avg_frame_rate": avg,
                "r_frame_rate": real,
                "language": null,
                "title": null,
                "width": 1920,
                "height": 1080,
                "channels": null,
                "disposition": {}
            }],
            "tracks": [],
            "cues": {},
            "cache_dir": "cache",
            "proxy_path": null
        }))
        .unwrap()
    }

    #[test]
    fn missing_frame_rate_falls_back_to_24() {
        assert_eq!(
            storyboard_frame_rate(&media_with_video_rate(None, None)),
            DEFAULT_MEDIA_FRAME_RATE
        );
        assert_eq!(
            storyboard_frame_rate(&media_with_video_rate(Some("0/0"), Some("0/0"))),
            24.0
        );
        assert_eq!(
            storyboard_frame_rate(&media_with_video_rate(Some(""), Some("not-a-rate"))),
            24.0
        );
        let mut missing_stream = media_with_video_rate(None, None);
        missing_stream.streams.clear();
        missing_stream.asset.video_stream_index = None;
        assert_eq!(storyboard_frame_rate(&missing_stream), 24.0);
        assert!(
            (storyboard_frame_rate(&media_with_video_rate(Some("30000/1001"), None))
                - (30_000.0 / 1001.0))
                .abs()
                < 1e-9
        );
        assert_eq!(
            storyboard_frame_rate(&media_with_video_rate(Some("25/1"), None)),
            25.0
        );
    }
}
