use super::*;

pub(super) const MAX_QUERY_BATCH: usize = 8;

pub(super) fn validate_queries(queries: &[String]) -> AppResult<()> {
    if queries.len() > 20
        || queries.iter().any(|query| {
            query.trim().is_empty()
                || query
                    .trim()
                    .chars()
                    .map(|c| if c.is_ascii() { 1 } else { 2 })
                    .sum::<usize>()
                    > 1000
        })
    {
        return Err(app_error(
            ErrorCode::SemanticInferenceFailed,
            "Invalid semantic prompt count or length",
        ));
    }
    Ok(())
}

/// Run bounded batches on a resident model. If a graph rejects a batch, reduce
/// its capacity for the rest of this request without constructing another model.
pub(super) fn infer_batches<T, U>(
    inputs: &[T],
    capacity: &mut usize,
    infer: &mut impl FnMut(&[T]) -> AppResult<Vec<U>>,
) -> AppResult<Vec<U>> {
    let mut output = Vec::with_capacity(inputs.len());
    let mut offset = 0;
    while offset < inputs.len() {
        let end = (offset + (*capacity).max(1)).min(inputs.len());
        match infer(&inputs[offset..end]) {
            Ok(rows) if rows.len() == end - offset => {
                output.extend(rows);
                offset = end;
            }
            Ok(_) => {
                return Err(app_error(
                    ErrorCode::SemanticInferenceFailed,
                    "Incomplete semantic prompt batch",
                ))
            }
            Err(_) if end - offset > 1 => {
                *capacity = ((end - offset) / 2).max(1);
            }
            Err(error) => return Err(error),
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batches_are_bounded_ordered_and_reuse_a_single_inference_context() {
        let inputs: Vec<_> = (0..20).collect();
        let mut calls = Vec::new();
        let mut capacity = MAX_QUERY_BATCH;
        let output = infer_batches(&inputs, &mut capacity, &mut |batch| {
            calls.push(batch.to_vec());
            Ok(batch.iter().map(|value| value * 2).collect::<Vec<_>>())
        })
        .unwrap();
        assert_eq!(calls.iter().map(Vec::len).collect::<Vec<_>>(), [8, 8, 4]);
        assert_eq!(
            output,
            inputs.iter().map(|value| value * 2).collect::<Vec<_>>()
        );
    }

    #[test]
    fn rejected_batches_fall_back_and_keep_the_same_context_for_remaining_inputs() {
        let mut calls = Vec::new();
        let mut capacity = MAX_QUERY_BATCH;
        let inputs: Vec<_> = (0..12).collect();
        let output = infer_batches(&inputs, &mut capacity, &mut |batch| {
            calls.push(batch.len());
            if batch.len() > 1 {
                return Err(app_error(ErrorCode::SemanticInferenceFailed, "single only"));
            }
            Ok(batch.to_vec())
        })
        .unwrap();
        assert_eq!(output, inputs);
        assert_eq!(&calls[..3], [8, 4, 2]);
        assert!(calls[3..].iter().all(|&size| size == 1));
        assert_eq!(capacity, 1);
    }

    #[test]
    fn prompt_limits_count_unicode_and_reject_incomplete_output() {
        assert!(validate_queries(&vec!["a".into(); 20]).is_ok());
        assert!(validate_queries(&vec!["a".into(); 21]).is_err());
        assert!(validate_queries(&["中".repeat(500)]).is_ok());
        assert!(validate_queries(&["中".repeat(501)]).is_err());
        assert!(validate_queries(&["a".repeat(1000)]).is_ok());
        assert!(validate_queries(&["a".repeat(1001)]).is_err());
        assert!(infer_batches(&[1, 2], &mut 2, &mut |_| Ok(Vec::<usize>::new())).is_err());
    }
}
