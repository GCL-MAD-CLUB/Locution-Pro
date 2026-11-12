//! Graph inputs come exclusively from completed SigLIP2 frame indexes.
use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoryboardGraphVector {
    id: String,
    vector: Vec<f32>,
    thumbnail_frame: usize,
}

fn mean_direction(vectors: &[Vec<f32>]) -> AppResult<Vec<f32>> {
    if vectors.is_empty()
        || vectors
            .iter()
            .any(|v| v.len() != siglip::DIMENSIONS || v.iter().any(|value| !value.is_finite()))
    {
        return Err(inference_error("Invalid storyboard graph vectors"));
    }
    let mut mean = vec![0.0f64; siglip::DIMENSIONS];
    for vector in vectors {
        for (sum, &value) in mean.iter_mut().zip(vector) {
            *sum += f64::from(value) / vectors.len() as f64;
        }
    }
    let norm = mean.iter().map(|value| value * value).sum::<f64>().sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        return Err(inference_error("Storyboard mean vector has no direction"));
    }
    Ok(mean
        .into_iter()
        .map(|value| (value / norm) as f32)
        .collect())
}

fn read_completed_vectors(
    sources: &[ShotSource],
    selection_root: &Path,
    semantic_root: &Path,
) -> AppResult<Vec<StoryboardGraphVector>> {
    let mut result = Vec::with_capacity(sources.len());
    for group in media_groups(sources) {
        let requests = group
            .iter()
            .map(|&i| {
                let source = &sources[i];
                let data = cache::read(selection_root, &source.identity).ok_or_else(|| {
                    inference_error("Storyboard selection must complete before graph layout")
                })?;
                Ok(index::ShotRequest {
                    start_frame: source.shot.start_frame,
                    end_frame: source.shot.end_frame,
                    frames: data.selection.selected_frames(),
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let vectors = index::read(semantic_root, &sources[group[0]].identity, &requests)?;
        for ((&i, request), vectors) in group.iter().zip(&requests).zip(vectors) {
            result.push(StoryboardGraphVector {
                id: sources[i].shot.id.clone(),
                vector: mean_direction(&vectors)?,
                thumbnail_frame: request.frames[0],
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn read_storyboard_graph_vectors(
    media_sources: crate::MediaSources,
    shots: Vec<SemanticShot>,
    state: tauri::State<'_, AppState>,
) -> CommandResult<Vec<StoryboardGraphVector>> {
    let sources = resolve_shots(shots, &media_sources)?;
    let preferences = preferences_clone(&state)?;
    let selection_root = cache::root(&preferences);
    let semantic_root = index::root(&preferences);
    tokio::task::spawn_blocking(move || {
        read_completed_vectors(&sources, &selection_root, &semantic_root)
    })
    .await
    .map_err(|error| {
        app_error(
            ErrorCode::BlockingTaskFailed,
            format!("Storyboard graph input task failed: {error}"),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vector(x: f32, y: f32) -> Vec<f32> {
        let mut result = vec![0.0; siglip::DIMENSIONS];
        result[0] = x;
        result[1] = y;
        result
    }

    #[test]
    fn graph_averages_all_selected_frames_then_normalizes() {
        let result =
            mean_direction(&[vector(1.0, 0.0), vector(0.0, 1.0), vector(0.0, 1.0)]).unwrap();
        assert!((result[0] - 1.0 / 5.0f32.sqrt()).abs() < 1e-6);
        assert!((result[1] - 2.0 / 5.0f32.sqrt()).abs() < 1e-6);
        assert_eq!(
            mean_direction(&[vector(1.0, 0.0)]).unwrap(),
            vector(1.0, 0.0)
        );
    }

    #[test]
    fn graph_rejects_incomplete_invalid_and_directionless_inputs() {
        assert!(mean_direction(&[]).is_err());
        assert!(mean_direction(&[vec![1.0]]).is_err());
        assert!(mean_direction(&[vector(f32::NAN, 0.0)]).is_err());
        assert!(mean_direction(&[vector(1.0, 0.0), vector(-1.0, 0.0)]).is_err());
    }
}
