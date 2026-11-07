//! CoreML execution provider: Apple GPU (Metal) inference on macOS.
//!
//! `ort` only exposes the legacy CoreML flags, which cannot select the
//! MLProgram format or static shapes, so the provider is registered through
//! ONNX Runtime's generic provider-options API instead.
use super::{available_cpu_threads, cpu_thread_budget};
use ort::session::{builder::GraphOptimizationLevel, Session};
use std::path::{Path, PathBuf};

/// Provider configurations in preference order. MLProgram covers the most
/// operators but plans DINOv3 only with static shapes; callers always fix
/// model dimensions before loading. NeuralNetwork is the older fallback.
const ATTEMPTS: [(&str, &str); 2] = [("MLProgram", "1"), ("NeuralNetwork", "0")];

pub(super) fn create_session(path: &Path, dimensions: &[(&str, i64)]) -> ort::Result<Session> {
    // Compiling a CoreML model takes tens of seconds per shape, so compiled
    // models persist in the user's cache directory, rebuilt if purged.
    let cache = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Caches/com.locutionpro.desktop"))
        .unwrap_or_else(std::env::temp_dir)
        .join("coreml");
    let entry = CacheEntry::new(path);
    entry.remove_stale(&cache);
    let prepared = prepare_model(path, &cache, &entry)?;
    let path = prepared.as_deref().unwrap_or(path);
    let mut errors = Vec::new();
    for (format, static_shapes) in ATTEMPTS {
        let compiled = cache.join("compiled").join(format!(
            "{}-{:016x}-{format}",
            entry.prefix(),
            stable_hash(&format!("{dimensions:?}"))
        ));
        // Converter rejections are deterministic for a model and shape, so
        // later launches skip them instead of paying the conversion again.
        // A failure may also be transient (memory pressure, a full disk), so
        // the verdict expires; app updates also start over with a new entry.
        let rejected = compiled.join("rejected");
        if is_recent(&rejected) {
            errors.push(format!("{format}: rejected by an earlier launch"));
            continue;
        }
        let _ = std::fs::create_dir_all(&compiled);
        // A compile interrupted by a crash leaves an unreadable cache entry;
        // retry once uncached instead of pinning the model to CPU.
        let session = register(path, dimensions, format, static_shapes, Some(&compiled))
            .or_else(|error| {
                tracing::warn!(model_path = %path.display(), format, %error, "CoreML session failed with its model cache; retrying uncached");
                let _ = std::fs::remove_dir_all(&compiled);
                register(path, dimensions, format, static_shapes, None)
            });
        match session {
            Ok(session) => {
                tracing::info!(model_path = %path.display(), format, "Created CoreML ONNX session");
                return Ok(session);
            }
            Err(error) => {
                if std::fs::create_dir_all(&compiled).is_ok() {
                    let _ = std::fs::write(&rejected, error.to_string());
                }
                errors.push(format!("{format}: {error}"));
            }
        }
    }
    Err(ort::Error::new(errors.join("; ")))
}

fn register(
    path: &Path,
    dimensions: &[(&str, i64)],
    format: &str,
    static_shapes: &str,
    cache: Option<&Path>,
) -> ort::Result<Session> {
    use ort::AsPointer;
    use std::ffi::{c_char, CString};

    // The Metal GPU matches Neural Engine throughput for these models, while
    // ANE-eligible sessions recompile for the ANE on every load (8-30 s even
    // with a warm cache, against under a second for GPU). Overridable for
    // diagnostics: ALL, CPUAndGPU, CPUAndNeuralEngine, CPUOnly.
    let compute_units = std::env::var("LOCUTION_PRO_COREML_COMPUTE_UNITS")
        .unwrap_or_else(|_| "CPUAndGPU".to_string());
    let mut options = vec![
        ("ModelFormat", format.to_string()),
        ("MLComputeUnits", compute_units),
        ("RequireStaticInputShapes", static_shapes.to_string()),
    ];
    if let Some(cache) = cache {
        options.push(("ModelCacheDirectory", cache.to_string_lossy().into_owned()));
    }
    let to_c =
        |value: &str| CString::new(value).map_err(|error| ort::Error::new(error.to_string()));
    let keys = options
        .iter()
        .map(|(key, _)| to_c(key))
        .collect::<ort::Result<Vec<_>>>()?;
    let values = options
        .iter()
        .map(|(_, value)| to_c(value))
        .collect::<ort::Result<Vec<_>>>()?;
    let key_ptrs = keys
        .iter()
        .map(|key| key.as_ptr())
        .collect::<Vec<*const c_char>>();
    let value_ptrs = values
        .iter()
        .map(|value| value.as_ptr())
        .collect::<Vec<*const c_char>>();
    let provider = to_c("CoreML")?;

    // Unsupported operators stay on the CPU provider, so keep its threads.
    let mut builder = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_intra_threads(cpu_thread_budget(available_cpu_threads()))?;
    let append = ort::api()
        .SessionOptionsAppendExecutionProvider
        .ok_or_else(|| {
            ort::Error::new("ONNX Runtime does not expose SessionOptionsAppendExecutionProvider")
        })?;
    // SAFETY: every pointer refers to a live NUL-terminated string for the
    // duration of the synchronous call, and both arrays have the same length.
    let status = unsafe {
        append(
            builder.ptr_mut(),
            provider.as_ptr(),
            key_ptrs.as_ptr(),
            value_ptrs.as_ptr(),
            key_ptrs.len(),
        )
    };
    status_to_result(status)?;
    for &(name, size) in dimensions {
        builder = builder.with_dimension_override(name, size)?;
    }
    builder.commit_from_file(path)
}

fn status_to_result(status: *mut ort::sys::OrtStatus) -> ort::Result<()> {
    if status.is_null() {
        return Ok(());
    }
    let api = ort::api();
    // SAFETY: a non-null status is owned by the caller and released exactly once.
    let message = unsafe {
        let message = api
            .GetErrorMessage
            .map(|get| get(status))
            .unwrap_or(std::ptr::null());
        let text = if message.is_null() {
            "unknown ONNX Runtime error".to_string()
        } else {
            std::ffi::CStr::from_ptr(message)
                .to_string_lossy()
                .into_owned()
        };
        if let Some(release) = api.ReleaseStatus {
            release(status);
        }
        text
    };
    Err(ort::Error::new(message))
}

/// How long a CoreML rejection is trusted before the conversion is retried.
const REJECTION_LIFETIME: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

fn is_recent(marker: &Path) -> bool {
    std::fs::metadata(marker)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_some_and(|age| age < REJECTION_LIFETIME)
}

/// FNV-1a: cache names must stay stable across Rust releases, which
/// `DefaultHasher` does not promise.
fn stable_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Names a model's cache entries as `{slot}-{version}-…`: the slot is the
/// model path, the version covers the model files and the app (and with it the
/// bundled ONNX Runtime). An update changes the version, so older entries for
/// the same slot are deleted rather than left behind; prepared copies are
/// as large as the model.
struct CacheEntry {
    slot: u64,
    version: u64,
}

impl CacheEntry {
    fn new(path: &Path) -> Self {
        let mut sidecar = path.as_os_str().to_owned();
        sidecar.push("_data");
        let identity = format!(
            "{}|{:?}|{:?}",
            env!("CARGO_PKG_VERSION"),
            file_identity(path),
            file_identity(Path::new(&sidecar)),
        );
        Self {
            slot: stable_hash(&path.to_string_lossy()),
            version: stable_hash(&identity),
        }
    }

    fn prefix(&self) -> String {
        format!("{:016x}-{:016x}", self.slot, self.version)
    }

    fn remove_stale(&self, cache: &Path) {
        let slot = format!("{:016x}-", self.slot);
        let current = self.prefix();
        for directory in [cache.join("prepared"), cache.join("compiled")] {
            let Ok(entries) = std::fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let stale = name.starts_with(&slot) && !name.starts_with(&current);
                if stale || is_legacy_entry(&name) {
                    let path = entry.path();
                    let removed = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };
                    if let Err(error) = removed {
                        tracing::warn!(path = %path.display(), %error, "Failed to remove a stale CoreML cache entry");
                    }
                }
            }
        }
    }
}

/// Entries named by a single 16-digit key, from builds before [`CacheEntry`];
/// their model cannot be recovered from the name, so they are all removed.
fn is_legacy_entry(name: &str) -> bool {
    let is_key = |part: &str| part.len() == 16 && part.bytes().all(|byte| byte.is_ascii_hexdigit());
    let mut parts = name.split(['-', '.']);
    parts.next().is_some_and(is_key) && !parts.next().is_some_and(is_key)
}

fn file_identity(path: &Path) -> Option<(u64, std::time::SystemTime)> {
    let metadata = std::fs::metadata(path).ok()?;
    Some((metadata.len(), metadata.modified().ok()?))
}

/// Rewrites the model once into a form the CoreML converter accepts; see
/// [`rewrite`]. Returns `None` when the original file needs no changes.
fn prepare_model(path: &Path, cache: &Path, entry: &CacheEntry) -> ort::Result<Option<PathBuf>> {
    let io = |error: std::io::Error| ort::Error::new(format!("Prepare CoreML model: {error}"));
    let key = entry.prefix();
    let directory = cache.join("prepared");
    let target = directory.join(format!("{key}.onnx"));
    let unchanged = directory.join(format!("{key}.unchanged"));
    if target.is_file() {
        return Ok(Some(target));
    }
    if unchanged.is_file() {
        return Ok(None);
    }
    std::fs::create_dir_all(&directory).map_err(io)?;
    let started = std::time::Instant::now();
    let model = std::fs::read(path).map_err(io)?;
    let base = path.parent().unwrap_or(Path::new("."));
    let rewritten = rewrite::model(&model, base)
        .ok_or_else(|| ort::Error::new(format!("Malformed ONNX model {}", path.display())))?;
    if rewritten == model {
        let _ = std::fs::write(&unchanged, []);
        return Ok(None);
    }
    // Write beside the target and rename so an interrupted write is never reused.
    let partial = target.with_extension("partial");
    std::fs::write(&partial, rewritten).map_err(io)?;
    std::fs::rename(&partial, &target).map_err(io)?;
    tracing::info!(model_path = %path.display(), prepared = %target.display(), elapsed_ms = started.elapsed().as_millis(), "Prepared ONNX model for CoreML");
    Ok(Some(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_names_use_a_stable_hash() {
        assert_eq!(stable_hash(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(stable_hash("a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn stale_and_legacy_cache_entries_are_removed() {
        let cache = std::env::temp_dir().join(format!("coreml-cache-{}", uuid::Uuid::new_v4()));
        let prepared = cache.join("prepared");
        let compiled = cache.join("compiled");
        std::fs::create_dir_all(&prepared).unwrap();
        std::fs::create_dir_all(&compiled).unwrap();
        let entry = CacheEntry {
            slot: 1,
            version: 2,
        };
        let old = CacheEntry {
            slot: 1,
            version: 3,
        };
        let other = CacheEntry {
            slot: 4,
            version: 5,
        };
        let keep = [
            prepared.join(format!("{}.onnx", entry.prefix())),
            prepared.join(format!("{}.onnx", other.prefix())),
            compiled.join(format!("{}-{:016x}-MLProgram", entry.prefix(), 6)),
        ];
        let remove = [
            prepared.join(format!("{}.onnx", old.prefix())),
            prepared.join("0123456789abcdef.onnx"),
            compiled.join(format!("{}-{:016x}-MLProgram", old.prefix(), 6)),
            compiled.join("0123456789abcdef-NeuralNetwork"),
        ];
        for path in keep.iter().chain(&remove) {
            if path.starts_with(&compiled) {
                std::fs::create_dir_all(path).unwrap();
            } else {
                std::fs::write(path, b"").unwrap();
            }
        }
        entry.remove_stale(&cache);
        assert!(keep.iter().all(|path| path.exists()));
        assert!(remove.iter().all(|path| !path.exists()));
        std::fs::remove_dir_all(cache).unwrap();
    }
}

/// Minimal protobuf rewrite of ModelProto -> GraphProto working around two
/// ONNX Runtime CoreML converter defects; every other field is copied byte
/// for byte, so the graph stays semantically identical:
///
/// - initializers in a sidecar `.onnx_data` file crash MLProgram weight
///   building, so `data_location = EXTERNAL` tensors become inline `raw_data`;
/// - a Conv with `auto_pad = VALID`, or with neither attribute (default
///   zeros), is emitted without MIL's required `pad` parameter, so the
///   equivalent explicit zero `pads` replaces it.
pub(super) mod rewrite {
    use std::{collections::HashMap, path::Path};

    const MODEL_GRAPH: u64 = 7;
    const GRAPH_NODE: u64 = 1;
    const GRAPH_INITIALIZER: u64 = 5;
    const NODE_OP_TYPE: u64 = 4;
    const NODE_ATTRIBUTE: u64 = 5;
    const ATTRIBUTE_NAME: u64 = 1;
    const ATTRIBUTE_STRING: u64 = 4;
    const ATTRIBUTE_INTS: u64 = 8;
    const ATTRIBUTE_TYPE: u64 = 20;
    const ATTRIBUTE_TYPE_INTS: u64 = 7;
    const TENSOR_RAW_DATA: u64 = 9;
    const TENSOR_EXTERNAL_DATA: u64 = 13;
    const TENSOR_DATA_LOCATION: u64 = 14;
    const LOCATION_EXTERNAL: u64 = 1;

    struct Field<'a> {
        number: u64,
        // The complete encoded field, tag included, for verbatim copies.
        raw: &'a [u8],
        // Length-delimited payload; empty for other wire types.
        payload: &'a [u8],
        // Varint value for wire type 0.
        varint: u64,
    }

    fn varint(buffer: &[u8], position: &mut usize) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *buffer.get(*position)?;
            *position += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    fn fields(buffer: &[u8]) -> Option<Vec<Field<'_>>> {
        let mut fields = Vec::new();
        let mut position = 0;
        while position < buffer.len() {
            let start = position;
            let tag = varint(buffer, &mut position)?;
            let (mut payload, mut value) = (&buffer[0..0], 0);
            match tag & 7 {
                0 => value = varint(buffer, &mut position)?,
                1 => position += 8,
                2 => {
                    let length = usize::try_from(varint(buffer, &mut position)?).ok()?;
                    payload = buffer.get(position..position.checked_add(length)?)?;
                    position += length;
                }
                5 => position += 4,
                _ => return None,
            }
            fields.push(Field {
                number: tag >> 3,
                raw: buffer.get(start..position)?,
                payload,
                varint: value,
            });
        }
        Some(fields)
    }

    fn put_varint(output: &mut Vec<u8>, mut value: u64) {
        while value >= 0x80 {
            output.push((value as u8) | 0x80);
            value >>= 7;
        }
        output.push(value as u8);
    }

    fn put_bytes(output: &mut Vec<u8>, number: u64, bytes: &[u8]) {
        put_varint(output, number << 3 | 2);
        put_varint(output, bytes.len() as u64);
        output.extend_from_slice(bytes);
    }

    pub(super) fn model(model: &[u8], base: &Path) -> Option<Vec<u8>> {
        let mut files = HashMap::new();
        let mut output = Vec::with_capacity(model.len());
        for field in fields(model)? {
            if field.number == MODEL_GRAPH {
                put_bytes(
                    &mut output,
                    MODEL_GRAPH,
                    &graph(field.payload, base, &mut files)?,
                );
            } else {
                output.extend_from_slice(field.raw);
            }
        }
        Some(output)
    }

    fn graph(graph: &[u8], base: &Path, files: &mut HashMap<String, Vec<u8>>) -> Option<Vec<u8>> {
        let mut output = Vec::with_capacity(graph.len());
        for field in fields(graph)? {
            match field.number {
                GRAPH_INITIALIZER => put_bytes(
                    &mut output,
                    GRAPH_INITIALIZER,
                    &tensor(field.payload, base, files)?,
                ),
                GRAPH_NODE => put_bytes(&mut output, GRAPH_NODE, &node(field.payload)?),
                _ => output.extend_from_slice(field.raw),
            }
        }
        Some(output)
    }

    fn attribute_name<'a>(attribute: &[Field<'a>]) -> Option<&'a [u8]> {
        attribute
            .iter()
            .find(|field| field.number == ATTRIBUTE_NAME)
            .map(|field| field.payload)
    }

    fn node(node: &[u8]) -> Option<Vec<u8>> {
        let parsed = fields(node)?;
        let is_conv = parsed
            .iter()
            .any(|field| field.number == NODE_OP_TYPE && field.payload == b"Conv");
        if !is_conv {
            return Some(node.to_vec());
        }
        let attributes = parsed
            .iter()
            .filter(|field| field.number == NODE_ATTRIBUTE)
            .map(|field| fields(field.payload))
            .collect::<Option<Vec<_>>>()?;
        let named = |name: &[u8]| {
            attributes
                .iter()
                .find(|attribute| attribute_name(attribute) == Some(name))
        };
        let auto_pad = named(b"auto_pad").and_then(|attribute| {
            attribute
                .iter()
                .find(|field| field.number == ATTRIBUTE_STRING)
                .map(|field| field.payload)
        });
        // SAME_* padding depends on input sizes and is left to the converter.
        let zero_padding =
            named(b"pads").is_none() && matches!(auto_pad, None | Some(b"NOTSET") | Some(b"VALID"));
        // The spatial rank comes from kernel_shape; without it the weight
        // shape would be needed, so leave such nodes untouched.
        let Some(kernel) = named(b"kernel_shape") else {
            return Some(node.to_vec());
        };
        if !zero_padding {
            return Some(node.to_vec());
        }
        let mut rank = 0;
        for field in kernel.iter().filter(|field| field.number == ATTRIBUTE_INTS) {
            if field.payload.is_empty() {
                rank += 1;
            } else {
                // Packed encoding: count the varints in the payload.
                let mut position = 0;
                while position < field.payload.len() {
                    varint(field.payload, &mut position)?;
                    rank += 1;
                }
            }
        }
        let mut pads = Vec::new();
        put_bytes(&mut pads, ATTRIBUTE_NAME, b"pads");
        put_bytes(&mut pads, ATTRIBUTE_INTS, &vec![0; 2 * rank]);
        put_varint(&mut pads, ATTRIBUTE_TYPE << 3);
        put_varint(&mut pads, ATTRIBUTE_TYPE_INTS);
        let mut output = Vec::with_capacity(node.len() + pads.len() + 2);
        for field in &parsed {
            let is_auto_pad = field.number == NODE_ATTRIBUTE
                && fields(field.payload)
                    .is_some_and(|attribute| attribute_name(&attribute) == Some(b"auto_pad"));
            if !is_auto_pad {
                output.extend_from_slice(field.raw);
            }
        }
        put_bytes(&mut output, NODE_ATTRIBUTE, &pads);
        Some(output)
    }

    fn tensor(tensor: &[u8], base: &Path, files: &mut HashMap<String, Vec<u8>>) -> Option<Vec<u8>> {
        let parsed = fields(tensor)?;
        let external = parsed
            .iter()
            .any(|field| field.number == TENSOR_DATA_LOCATION && field.varint == LOCATION_EXTERNAL);
        if !external {
            return Some(tensor.to_vec());
        }
        let mut entries = HashMap::new();
        for field in parsed
            .iter()
            .filter(|field| field.number == TENSOR_EXTERNAL_DATA)
        {
            let (mut key, mut value) = ("", "");
            for entry in fields(field.payload)? {
                let text = std::str::from_utf8(entry.payload).ok()?;
                match entry.number {
                    1 => key = text,
                    2 => value = text,
                    _ => {}
                }
            }
            entries.insert(key, value);
        }
        let location = *entries.get("location")?;
        // Locations are relative names beside the model; reject path escapes.
        if location.contains("..") || Path::new(location).is_absolute() {
            return None;
        }
        if !files.contains_key(location) {
            files.insert(
                location.to_owned(),
                std::fs::read(base.join(location)).ok()?,
            );
        }
        let data = files.get(location)?;
        let offset = entries
            .get("offset")
            .map_or(Some(0), |value| value.parse().ok())?;
        let length = match entries.get("length") {
            Some(value) => value.parse().ok()?,
            None => data.len().checked_sub(offset)?,
        };
        let bytes = data.get(offset..offset.checked_add(length)?)?;
        let mut output = Vec::with_capacity(tensor.len() + bytes.len() + 10);
        for field in parsed.iter().filter(|field| {
            !matches!(
                field.number,
                TENSOR_EXTERNAL_DATA | TENSOR_DATA_LOCATION | TENSOR_RAW_DATA
            )
        }) {
            output.extend_from_slice(field.raw);
        }
        put_bytes(&mut output, TENSOR_RAW_DATA, bytes);
        Some(output)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn attribute(name: &[u8], ints: &[u8]) -> Vec<u8> {
            let mut attribute = Vec::new();
            put_bytes(&mut attribute, ATTRIBUTE_NAME, name);
            put_bytes(&mut attribute, ATTRIBUTE_INTS, ints);
            attribute
        }

        fn conv(attributes: &[Vec<u8>]) -> Vec<u8> {
            let mut node = Vec::new();
            put_bytes(&mut node, NODE_OP_TYPE, b"Conv");
            for attribute in attributes {
                put_bytes(&mut node, NODE_ATTRIBUTE, attribute);
            }
            node
        }

        fn model_with(graph: &[u8]) -> Vec<u8> {
            let mut model = Vec::new();
            put_varint(&mut model, 1 << 3); // ir_version
            put_varint(&mut model, 8);
            put_bytes(&mut model, MODEL_GRAPH, graph);
            model
        }

        #[test]
        fn conv_without_pads_gets_explicit_zero_padding() {
            let mut graph = Vec::new();
            put_bytes(
                &mut graph,
                GRAPH_NODE,
                &conv(&[attribute(b"kernel_shape", &[16, 16])]),
            );
            let rewritten = model(&model_with(&graph), Path::new(".")).unwrap();
            let graph = fields(&rewritten)
                .unwrap()
                .into_iter()
                .find(|f| f.number == MODEL_GRAPH)
                .unwrap()
                .payload
                .to_vec();
            let node = fields(&graph).unwrap()[0].payload.to_vec();
            let pads = fields(&node)
                .unwrap()
                .into_iter()
                .filter(|field| field.number == NODE_ATTRIBUTE)
                .map(|field| {
                    fields(field.payload)
                        .unwrap()
                        .iter()
                        .map(|f| (f.number, f.payload.to_vec(), f.varint))
                        .collect::<Vec<_>>()
                })
                .find(|attribute| attribute[0].1 == b"pads")
                .expect("pads attribute");
            assert_eq!(pads[1], (ATTRIBUTE_INTS, vec![0, 0, 0, 0], 0));
            assert_eq!(
                (pads[2].0, pads[2].2),
                (ATTRIBUTE_TYPE, ATTRIBUTE_TYPE_INTS)
            );
        }

        #[test]
        fn valid_auto_pad_becomes_explicit_zero_padding() {
            let mut auto_pad = Vec::new();
            put_bytes(&mut auto_pad, ATTRIBUTE_NAME, b"auto_pad");
            put_bytes(&mut auto_pad, ATTRIBUTE_STRING, b"VALID");
            let mut graph = Vec::new();
            put_bytes(
                &mut graph,
                GRAPH_NODE,
                &conv(&[auto_pad, attribute(b"kernel_shape", &[16, 16])]),
            );
            let rewritten = model(&model_with(&graph), Path::new(".")).unwrap();
            let graph = fields(&rewritten)
                .unwrap()
                .into_iter()
                .find(|f| f.number == MODEL_GRAPH)
                .unwrap()
                .payload
                .to_vec();
            let node = fields(&graph).unwrap()[0].payload.to_vec();
            let names = fields(&node)
                .unwrap()
                .into_iter()
                .filter(|field| field.number == NODE_ATTRIBUTE)
                .map(|field| {
                    attribute_name(&fields(field.payload).unwrap())
                        .unwrap()
                        .to_vec()
                })
                .collect::<Vec<_>>();
            assert_eq!(names, [b"kernel_shape".to_vec(), b"pads".to_vec()]);
        }

        #[test]
        fn models_without_converter_hazards_are_unchanged() {
            let mut graph = Vec::new();
            put_bytes(
                &mut graph,
                GRAPH_NODE,
                &conv(&[
                    attribute(b"kernel_shape", &[3, 3]),
                    attribute(b"pads", &[1, 1, 1, 1]),
                ]),
            );
            let original = model_with(&graph);
            assert_eq!(model(&original, Path::new(".")).unwrap(), original);
        }

        #[test]
        fn external_initializers_are_inlined() {
            let directory =
                std::env::temp_dir().join(format!("coreml-rewrite-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("weights.bin"), b"xxABCDyy").unwrap();
            let entry = |key: &[u8], value: &[u8]| {
                let mut entry = Vec::new();
                put_bytes(&mut entry, 1, key);
                put_bytes(&mut entry, 2, value);
                entry
            };
            let mut tensor = Vec::new();
            put_bytes(&mut tensor, 8, b"weight"); // name
            put_bytes(
                &mut tensor,
                TENSOR_EXTERNAL_DATA,
                &entry(b"location", b"weights.bin"),
            );
            put_bytes(&mut tensor, TENSOR_EXTERNAL_DATA, &entry(b"offset", b"2"));
            put_bytes(&mut tensor, TENSOR_EXTERNAL_DATA, &entry(b"length", b"4"));
            put_varint(&mut tensor, TENSOR_DATA_LOCATION << 3);
            put_varint(&mut tensor, LOCATION_EXTERNAL);
            let mut graph = Vec::new();
            put_bytes(&mut graph, GRAPH_INITIALIZER, &tensor);
            let rewritten = model(&model_with(&graph), &directory).unwrap();
            let graph = fields(&rewritten)
                .unwrap()
                .into_iter()
                .find(|f| f.number == MODEL_GRAPH)
                .unwrap()
                .payload
                .to_vec();
            let tensor = fields(&graph).unwrap()[0].payload.to_vec();
            let tensor = fields(&tensor).unwrap();
            assert!(tensor
                .iter()
                .all(|f| f.number != TENSOR_EXTERNAL_DATA && f.number != TENSOR_DATA_LOCATION));
            assert_eq!(
                tensor
                    .iter()
                    .find(|f| f.number == TENSOR_RAW_DATA)
                    .unwrap()
                    .payload,
                b"ABCD"
            );
            std::fs::remove_dir_all(directory).unwrap();
        }

        #[test]
        fn external_locations_cannot_escape_the_model_directory() {
            let mut entry = Vec::new();
            put_bytes(&mut entry, 1, b"location");
            put_bytes(&mut entry, 2, b"../secret");
            let mut tensor = Vec::new();
            put_bytes(&mut tensor, TENSOR_EXTERNAL_DATA, &entry);
            put_varint(&mut tensor, TENSOR_DATA_LOCATION << 3);
            put_varint(&mut tensor, LOCATION_EXTERNAL);
            let mut graph = Vec::new();
            put_bytes(&mut graph, GRAPH_INITIALIZER, &tensor);
            assert!(model(&model_with(&graph), Path::new(".")).is_none());
        }
    }
}
