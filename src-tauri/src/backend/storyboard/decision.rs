use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use super::TransnetPredictions;
use crate::{app_error, AppResult, ErrorCode};

const FEATURE_NAMES: [&str; 10] = [
    "peak_logit",
    "robust_prominence",
    "log_event_area",
    "log_event_width",
    "concentration",
    "left_slope",
    "right_slope",
    "asymmetry",
    "background_difference",
    "neighbor_mass",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoryboardDecisionConfig {
    pub model_version: u32,
    pub model_origin: String,
    pub epsilon: f64,
    pub robust_window_radius: usize,
    pub candidate_probability_threshold: f64,
    pub peak_radius: usize,
    pub candidate_robust_threshold: f64,
    pub event_probability_floor: f64,
    pub event_relative_floor: f64,
    pub event_robust_floor: f64,
    pub event_boundary_patience: usize,
    /// Retained so existing event-model files keep a stable schema. Interval
    /// features no longer drive acceptance.
    #[allow(dead_code)]
    pub neighbor_radius: usize,
    pub classifier: EventClassifier,
    pub calibration: Option<BetaCalibration>,
    pub false_positive_cost: f64,
    pub false_negative_cost: f64,
    pub single_frame_threshold: f64,
    pub many_hot_threshold: f64,
    pub gradual_transition_mass: f64,
    pub minimum_event_gap_seconds: f64,
    pub short_shot_midpoint_seconds: f64,
    pub short_shot_softness_seconds: f64,
}

impl Default for StoryboardDecisionConfig {
    fn default() -> Self {
        Self {
            model_version: 1,
            model_origin: "threshold_rules_uncalibrated".to_string(),
            epsilon: 1.0e-6,
            robust_window_radius: 50,
            candidate_probability_threshold: 0.1,
            peak_radius: 2,
            candidate_robust_threshold: 2.5,
            event_probability_floor: 0.03,
            event_relative_floor: 0.15,
            event_robust_floor: 1.5,
            event_boundary_patience: 2,
            neighbor_radius: 2,
            classifier: EventClassifier {
                feature_order: FEATURE_NAMES
                    .iter()
                    .map(|name| (*name).to_string())
                    .collect(),
                intercept: -2.5,
                coefficients: vec![0.55, 0.0, -0.3, -0.6, 2.2, 0.75, 0.75, -0.4, 1.1, -0.12],
            },
            calibration: None,
            false_positive_cost: 1.0,
            false_negative_cost: 2.0,
            single_frame_threshold: 0.5,
            many_hot_threshold: 0.5,
            gradual_transition_mass: 1.5,
            minimum_event_gap_seconds: 0.12,
            short_shot_midpoint_seconds: 0.12,
            short_shot_softness_seconds: 0.12,
        }
    }
}

impl StoryboardDecisionConfig {
    pub(super) fn validate(&self) -> AppResult<()> {
        if self.model_version != 1 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                format!(
                    "Unsupported storyboard event model version {}",
                    self.model_version
                ),
            ));
        }
        if self.model_origin.trim().is_empty() {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard event model origin must not be empty",
            ));
        }
        if !self.epsilon.is_finite() || !(0.0..0.5).contains(&self.epsilon) {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard event model epsilon must be finite and in (0, 0.5)",
            ));
        }
        validate_probability(
            "candidate_probability_threshold",
            self.candidate_probability_threshold,
        )?;
        validate_probability("event_probability_floor", self.event_probability_floor)?;
        validate_probability("event_relative_floor", self.event_relative_floor)?;
        validate_probability("single_frame_threshold", self.single_frame_threshold)?;
        validate_probability("many_hot_threshold", self.many_hot_threshold)?;
        validate_finite(
            "candidate_robust_threshold",
            self.candidate_robust_threshold,
        )?;
        validate_finite("event_robust_floor", self.event_robust_floor)?;
        if self.event_boundary_patience == 0 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard event boundary patience must be at least 1",
            ));
        }
        self.classifier.validate()?;
        if let Some(calibration) = &self.calibration {
            calibration.validate()?;
        }
        if !self.false_positive_cost.is_finite() || self.false_positive_cost <= 0.0 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard false-positive cost must be finite and positive",
            ));
        }
        if !self.false_negative_cost.is_finite() || self.false_negative_cost <= 0.0 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard false-negative cost must be finite and positive",
            ));
        }
        if !self.gradual_transition_mass.is_finite() || self.gradual_transition_mass < 0.0 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard gradual-transition mass must be finite and non-negative",
            ));
        }
        if !self.minimum_event_gap_seconds.is_finite() || self.minimum_event_gap_seconds < 0.0 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard minimum event gap must be finite and non-negative",
            ));
        }
        if !self.short_shot_midpoint_seconds.is_finite() || self.short_shot_midpoint_seconds < 0.0 {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard short-shot midpoint must be finite and non-negative",
            ));
        }
        if !self.short_shot_softness_seconds.is_finite() || self.short_shot_softness_seconds <= 0.0
        {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard short-shot softness must be finite and positive",
            ));
        }
        Ok(())
    }

    fn minimum_event_gap_us(&self) -> i64 {
        seconds_to_us(self.minimum_event_gap_seconds)
    }
}

/// Parsed for schema stability. Coefficients are not fitted and are not the
/// accept/reject rule.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EventClassifier {
    feature_order: Vec<String>,
    intercept: f64,
    coefficients: Vec<f64>,
}

impl EventClassifier {
    fn validate(&self) -> AppResult<()> {
        if self.feature_order.as_slice() != FEATURE_NAMES {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                format!(
                    "Storyboard feature order must exactly match [{}]",
                    FEATURE_NAMES.join(", ")
                ),
            ));
        }
        if self.coefficients.len() != FEATURE_NAMES.len() {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                format!(
                    "Storyboard classifier must contain {} coefficients",
                    FEATURE_NAMES.len()
                ),
            ));
        }
        validate_finite("classifier intercept", self.intercept)?;
        if self.coefficients.iter().any(|value| !value.is_finite()) {
            return Err(app_error(
                ErrorCode::StoryboardInferenceFailed,
                "Storyboard classifier coefficients must be finite",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct BetaCalibration {
    a: f64,
    b: f64,
    c: f64,
}

impl BetaCalibration {
    fn validate(&self) -> AppResult<()> {
        validate_finite("calibration a", self.a)?;
        validate_finite("calibration b", self.b)?;
        validate_finite("calibration c", self.c)
    }

    fn calibrate(&self, probability: f64, epsilon: f64) -> f64 {
        let probability = probability.clamp(epsilon, 1.0 - epsilon);
        sigmoid(
            self.a * (probability + epsilon).ln()
                - self.b * (1.0 - probability + epsilon).ln()
                - self.c,
        )
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StoryboardCut {
    pub(super) cut_frame: usize,
    pub(super) confidence: f64,
    pub(super) event_start: usize,
    pub(super) event_end: usize,
    pub(super) peak_probability: f64,
    pub(super) robust_prominence: f64,
    pub(super) event_area: f64,
    pub(super) event_width: usize,
}

#[derive(Debug, Clone)]
struct RobustSeries {
    probabilities: Vec<f64>,
    logits: Vec<f64>,
    // Locked by the rolling-statistic test. Acceptance uses robust scores.
    #[allow(dead_code)]
    probability_medians: Vec<f64>,
    robust_scores: Vec<f64>,
}

#[derive(Debug, Clone, Copy)]
struct EventInterval {
    start: usize,
    end: usize,
}

#[derive(Debug, Clone)]
struct ScoredEvent {
    interval: EventInterval,
    cut_frame: usize,
    time_us: i64,
    peak_probability: f64,
    robust_prominence: f64,
    area: f64,
    width: usize,
    strength: f64,
}

pub(super) fn detect_storyboard_cuts(
    predictions: &TransnetPredictions,
    frame_times_us: Option<&[i64]>,
    frame_rate: f64,
    config: &StoryboardDecisionConfig,
) -> Vec<StoryboardCut> {
    let frame_count = predictions.single_frame.len();
    if frame_count == 0 {
        return Vec::new();
    }

    let many_hot = predictions
        .many_hot
        .len()
        .eq(&frame_count)
        .then_some(predictions.many_hot.as_slice());
    let frame_times = frame_times_us.filter(|times| times.len() == frame_count);
    let single = robust_series(&predictions.single_frame, config);
    let many = many_hot.map(|values| robust_series(values, config));
    let mut peaks = candidate_peaks(&single, config);
    if let Some(series) = &many {
        peaks.extend(candidate_peaks(series, config));
    }
    peaks.sort_unstable();
    peaks.dedup();

    let mut events = candidate_event_intervals(&single, many.as_ref(), &peaks, config)
        .into_iter()
        .filter_map(|interval| {
            score_event(
                &single,
                many.as_ref(),
                interval,
                frame_times,
                frame_rate,
                config,
            )
        })
        .collect::<Vec<_>>();
    events = non_maximum_suppression(events, config.minimum_event_gap_us());
    apply_short_shot_constraint(events, config)
}

fn robust_series(predictions: &[f32], config: &StoryboardDecisionConfig) -> RobustSeries {
    let probabilities = predictions
        .iter()
        .map(|prediction| {
            if prediction.is_finite() {
                (*prediction as f64).clamp(0.0, 1.0)
            } else {
                0.0
            }
        })
        .collect::<Vec<_>>();
    let logits = probabilities
        .iter()
        .map(|probability| logit(*probability, config.epsilon))
        .collect::<Vec<_>>();
    let mut probability_medians = Vec::with_capacity(predictions.len());
    let mut robust_scores = Vec::with_capacity(predictions.len());
    // Probabilities and logits have the same ordering. Maintain their exact
    // middle elements as the window slides, including the even-length edges.
    // MAD still needs selection, but reuses one allocation for the entire clip.
    let capacity = config
        .robust_window_radius
        .saturating_mul(2)
        .saturating_add(1)
        .min(predictions.len());
    let mut sorted = Vec::<(f64, f64)>::with_capacity(capacity);
    let mut deviations = Vec::with_capacity(capacity);
    let mut previous_start = 0;
    let mut previous_end = 0;

    for index in 0..predictions.len() {
        let start = index.saturating_sub(config.robust_window_radius);
        let end = index
            .saturating_add(config.robust_window_radius)
            .saturating_add(1)
            .min(predictions.len());
        for probability in &probabilities[previous_start..start] {
            let position = sorted
                .binary_search_by(|entry| entry.0.total_cmp(probability))
                .expect("departing probability belongs to the rolling window");
            sorted.remove(position);
        }
        for next in previous_end..end {
            let entry = (probabilities[next], logits[next]);
            let position = sorted.partition_point(|known| known.0.total_cmp(&entry.0).is_lt());
            sorted.insert(position, entry);
        }
        previous_start = start;
        previous_end = end;
        let middle = sorted.len() / 2;
        let (mut probability_median, mut logit_median) = sorted[middle];
        if sorted.len() % 2 == 0 {
            probability_median = (sorted[middle - 1].0 + probability_median) / 2.0;
            logit_median = (sorted[middle - 1].1 + logit_median) / 2.0;
        }
        deviations.clear();
        deviations.extend(
            logits[start..end]
                .iter()
                .map(|value| (value - logit_median).abs()),
        );
        let scale = 1.4826 * median(&mut deviations) + config.epsilon;

        probability_medians.push(probability_median);
        robust_scores.push((logits[index] - logit_median) / scale);
    }

    RobustSeries {
        probabilities,
        logits,
        probability_medians,
        robust_scores,
    }
}

fn candidate_peaks(series: &RobustSeries, config: &StoryboardDecisionConfig) -> Vec<usize> {
    series
        .probabilities
        .iter()
        .enumerate()
        .filter_map(|(index, probability)| {
            if *probability < config.candidate_probability_threshold
                || series.robust_scores[index] < config.candidate_robust_threshold
            {
                return None;
            }

            let start = index.saturating_sub(config.peak_radius);
            let end = index
                .saturating_add(config.peak_radius)
                .min(series.probabilities.len() - 1);
            let maximum = series.probabilities[start..=end]
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max);
            let earliest_maximum = series.probabilities[start..=end]
                .iter()
                .position(|value| *value == maximum)
                .map(|offset| start + offset);
            (probability.total_cmp(&maximum).is_eq() && earliest_maximum == Some(index))
                .then_some(index)
        })
        .collect()
}

fn candidate_event_intervals(
    single: &RobustSeries,
    many: Option<&RobustSeries>,
    peaks: &[usize],
    config: &StoryboardDecisionConfig,
) -> Vec<EventInterval> {
    let mut intervals = peaks
        .iter()
        .map(|peak| expand_event_interval(single, many, *peak, config))
        .collect::<Vec<_>>();
    intervals.sort_by_key(|interval| (interval.start, interval.end));

    let mut merged = Vec::<EventInterval>::new();
    for interval in intervals {
        if let Some(previous) = merged.last_mut() {
            if interval.start <= previous.end {
                previous.end = previous.end.max(interval.end);
                continue;
            }
        }
        merged.push(interval);
    }
    merged
}

fn expand_event_interval(
    single: &RobustSeries,
    many: Option<&RobustSeries>,
    peak: usize,
    config: &StoryboardDecisionConfig,
) -> EventInterval {
    let qualifies = |index: usize| {
        series_qualifies(single, index, peak, config)
            || many.is_some_and(|series| series_qualifies(series, index, peak, config))
    };

    let mut start = peak;
    let mut misses = 0usize;
    for index in (0..peak).rev() {
        if qualifies(index) {
            start = index;
            misses = 0;
        } else {
            misses += 1;
            if misses >= config.event_boundary_patience {
                break;
            }
        }
    }

    let mut end = peak;
    misses = 0;
    for index in peak + 1..single.probabilities.len() {
        if qualifies(index) {
            end = index;
            misses = 0;
        } else {
            misses += 1;
            if misses >= config.event_boundary_patience {
                break;
            }
        }
    }
    EventInterval { start, end }
}

fn series_qualifies(
    series: &RobustSeries,
    index: usize,
    peak: usize,
    config: &StoryboardDecisionConfig,
) -> bool {
    let seeded = series.probabilities[peak] >= config.candidate_probability_threshold
        || series.robust_scores[peak] >= config.candidate_robust_threshold;
    if !seeded {
        // A head that did not produce this candidate must not stretch the
        // interval across its own background.
        return series.robust_scores[index] >= config.event_robust_floor;
    }
    let floor = config
        .event_probability_floor
        .max(config.event_relative_floor * series.probabilities[peak]);
    series.probabilities[index] >= floor || series.robust_scores[index] >= config.event_robust_floor
}

fn score_event(
    single: &RobustSeries,
    many: Option<&RobustSeries>,
    interval: EventInterval,
    frame_times: Option<&[i64]>,
    frame_rate: f64,
    config: &StoryboardDecisionConfig,
) -> Option<ScoredEvent> {
    let single_probabilities = &single.probabilities[interval.start..=interval.end];
    let peak_probability = single_probabilities
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let many_peak = many
        .map(|series| {
            series.probabilities[interval.start..=interval.end]
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max)
        })
        .unwrap_or(0.0);
    let area = single_probabilities.iter().sum::<f64>();
    let gradual = area >= config.gradual_transition_mass
        && peak_probability >= config.candidate_probability_threshold;
    let accepted = peak_probability >= config.single_frame_threshold
        || many_peak >= config.many_hot_threshold
        || gradual;
    if !accepted {
        return None;
    }

    let cut_frame = place_cut(single, many, interval, config);
    let single_prominence = single.robust_scores[interval.start..=interval.end]
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let many_prominence = many
        .map(|series| {
            series.robust_scores[interval.start..=interval.end]
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, f64::max)
        })
        .unwrap_or(f64::NEG_INFINITY);
    Some(ScoredEvent {
        interval,
        cut_frame,
        time_us: frame_time_us(cut_frame, frame_times, frame_rate),
        peak_probability,
        robust_prominence: single_prominence.max(many_prominence),
        area,
        width: interval.end - interval.start + 1,
        strength: peak_probability
            .max(many_peak)
            .max(config.single_frame_threshold),
    })
}

fn place_cut(
    single: &RobustSeries,
    many: Option<&RobustSeries>,
    interval: EventInterval,
    config: &StoryboardDecisionConfig,
) -> usize {
    let single_excess = excess(
        &single.probabilities[interval.start..=interval.end],
        config.single_frame_threshold,
    );
    let many_excess = many.map(|series| {
        excess(
            &series.probabilities[interval.start..=interval.end],
            config.many_hot_threshold,
        )
    });
    let weights = localization_weights(
        &single_excess,
        many_excess.as_deref(),
        &single.probabilities[interval.start..=interval.end],
    );
    interval.start + weighted_median_index(&weights)
}

fn localization_weights(
    single_excess: &[f64],
    many_excess: Option<&[f64]>,
    raw_single: &[f64],
) -> Vec<f64> {
    let single_total = single_excess.iter().sum::<f64>();
    let many_total = many_excess
        .map(|weights| weights.iter().sum::<f64>())
        .unwrap_or(0.0);
    if let Some(many_excess) = many_excess {
        if many_total > 0.0 && mass_concentration(many_excess) > mass_concentration(single_excess) {
            return many_excess.to_vec();
        }
    }
    if single_total > 0.0 {
        return single_excess.to_vec();
    }
    if let Some(many_excess) = many_excess {
        if many_total > 0.0 {
            return many_excess.to_vec();
        }
    }
    raw_single.to_vec()
}

fn excess(probabilities: &[f64], threshold: f64) -> Vec<f64> {
    probabilities
        .iter()
        .map(|probability| (probability - threshold).max(0.0))
        .collect()
}

fn mass_concentration(weights: &[f64]) -> f64 {
    let total = weights.iter().sum::<f64>();
    if total <= 0.0 {
        0.0
    } else {
        weights.iter().copied().fold(0.0, f64::max) / total
    }
}

/// Smallest index whose cumulative weight reaches half the total. An equal
/// plateau that contains more than one median keeps the later central frame.
fn weighted_median_index(weights: &[f64]) -> usize {
    if weights.is_empty() {
        return 0;
    }
    let total = weights.iter().sum::<f64>();
    if !total.is_finite() || total <= 0.0 {
        return weights.len() / 2;
    }
    let half = total * 0.5;
    let mut cumulative = 0.0;
    let mut low = weights.len() - 1;
    for (index, weight) in weights.iter().enumerate() {
        cumulative += *weight;
        if cumulative + 1.0e-9 >= half {
            low = index;
            break;
        }
    }
    let mut high = low;
    let plateau = weights[low];
    while high + 1 < weights.len() && (weights[high + 1] - plateau).abs() <= 1.0e-9 {
        if cumulative <= half + 1.0e-9 {
            cumulative += weights[high + 1];
            high += 1;
        } else {
            break;
        }
    }
    low + (high - low + 1) / 2
}

fn non_maximum_suppression(mut events: Vec<ScoredEvent>, minimum_gap_us: i64) -> Vec<ScoredEvent> {
    events.sort_by(compare_event_priority);
    let mut retained = Vec::<ScoredEvent>::new();
    let mut retained_times = BTreeSet::new();
    for event in events {
        let time = event.time_us;
        let conflicts = minimum_gap_us > 0
            && retained_times
                .range(
                    time.saturating_sub(minimum_gap_us.saturating_sub(1))
                        ..=time.saturating_add(minimum_gap_us.saturating_sub(1)),
                )
                .next()
                .is_some();
        if !conflicts {
            retained_times.insert(time);
            retained.push(event);
        }
    }
    retained.sort_by_key(|event| event.cut_frame);
    retained
}

fn compare_event_priority(left: &ScoredEvent, right: &ScoredEvent) -> std::cmp::Ordering {
    right
        .strength
        .total_cmp(&left.strength)
        .then_with(|| right.peak_probability.total_cmp(&left.peak_probability))
        .then_with(|| right.robust_prominence.total_cmp(&left.robust_prominence))
        .then_with(|| left.time_us.cmp(&right.time_us))
        .then_with(|| left.cut_frame.cmp(&right.cut_frame))
}

fn apply_short_shot_constraint(
    events: Vec<ScoredEvent>,
    config: &StoryboardDecisionConfig,
) -> Vec<StoryboardCut> {
    let mut previous_time = None;
    let mut cuts = Vec::new();

    for event in events {
        let length_factor = previous_time.map_or(1.0, |previous: i64| {
            let distance_seconds =
                event.time_us.saturating_sub(previous).max(0) as f64 / 1_000_000.0;
            sigmoid(
                (distance_seconds - config.short_shot_midpoint_seconds)
                    / config.short_shot_softness_seconds,
            )
        });
        let confidence = event.strength * length_factor;
        if confidence < config.single_frame_threshold {
            continue;
        }

        previous_time = Some(event.time_us);
        cuts.push(StoryboardCut {
            cut_frame: event.cut_frame,
            confidence,
            event_start: event.interval.start,
            event_end: event.interval.end,
            peak_probability: event.peak_probability,
            robust_prominence: event.robust_prominence,
            event_area: event.area,
            event_width: event.width,
        });
    }
    cuts
}

fn frame_time_us(frame: usize, frame_times: Option<&[i64]>, frame_rate: f64) -> i64 {
    frame_times
        .and_then(|times| times.get(frame).copied())
        .unwrap_or_else(|| synthetic_frame_time_us(frame, frame_rate))
}

pub(super) fn synthetic_frame_time_us(frame: usize, frame_rate: f64) -> i64 {
    if !frame_rate.is_finite() || frame_rate <= 0.0 {
        return 0;
    }
    let micros = (frame as f64 / frame_rate) * 1_000_000.0;
    if !micros.is_finite() {
        return 0;
    }
    micros.round().clamp(i64::MIN as f64, i64::MAX as f64) as i64
}

fn seconds_to_us(seconds: f64) -> i64 {
    let micros = seconds * 1_000_000.0;
    if !micros.is_finite() || micros <= 0.0 {
        return 0;
    }
    micros.round().clamp(0.0, i64::MAX as f64) as i64
}

fn validate_probability(name: &str, value: f64) -> AppResult<()> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(())
    } else {
        Err(app_error(
            ErrorCode::StoryboardInferenceFailed,
            format!("Storyboard event model {name} must be finite and in [0, 1]"),
        ))
    }
}

fn validate_finite(name: &str, value: f64) -> AppResult<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(app_error(
            ErrorCode::StoryboardInferenceFailed,
            format!("Storyboard event model {name} must be finite"),
        ))
    }
}

fn logit(probability: f64, epsilon: f64) -> f64 {
    let probability = probability.clamp(epsilon, 1.0 - epsilon);
    (probability / (1.0 - probability)).ln()
}

fn sigmoid(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exponential = value.exp();
        exponential / (1.0 + exponential)
    }
}

fn median(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let middle = values.len() / 2;
    values.select_nth_unstable_by(middle, f64::total_cmp);
    let upper = values[middle];
    if values.len() % 2 == 1 {
        upper
    } else {
        let lower = values[..middle]
            .iter()
            .copied()
            .max_by(f64::total_cmp)
            .unwrap_or(upper);
        (lower + upper) / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_median(mut values: Vec<f64>) -> f64 {
        values.sort_by(f64::total_cmp);
        let middle = values.len() / 2;
        if values.len() % 2 == 0 {
            (values[middle - 1] + values[middle]) / 2.0
        } else {
            values[middle]
        }
    }

    fn predictions_of(single_frame: Vec<f32>) -> TransnetPredictions {
        TransnetPredictions {
            single_frame,
            many_hot: Vec::new(),
        }
    }

    fn detect(single_frame: Vec<f32>) -> Vec<StoryboardCut> {
        detect_storyboard_cuts(&predictions_of(single_frame), None, 25.0, &default_config())
    }

    #[test]
    fn rolling_statistics_match_independent_sorted_reference() {
        let mut seed = 42u32;
        let mut predictions = (0..4097)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed % 1024) as f32 / 1023.0
            })
            .collect::<Vec<_>>();
        predictions[..10].copy_from_slice(&[
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
            -1.0,
            -0.0,
            0.0,
            1.0,
            2.0,
            0.5,
            0.5,
        ]);
        for count in [0, 1, 2, 49, 50, 51, 100, 101, 4097] {
            for radius in [0, 1, 2, 50, usize::MAX] {
                if count > 101 && radius == usize::MAX {
                    // Full-window and saturating arithmetic are covered above;
                    // keep the independently sorted reference inexpensive.
                    continue;
                }
                for epsilon in [1.0e-6, 0.1] {
                    let config = StoryboardDecisionConfig {
                        robust_window_radius: radius,
                        epsilon,
                        ..default_config()
                    };
                    let series = robust_series(&predictions[..count], &config);
                    for index in 0..count {
                        let start = index.saturating_sub(radius);
                        let end = index.saturating_add(radius).min(count - 1);
                        let probability_median =
                            reference_median(series.probabilities[start..=end].to_vec());
                        let logit_median = reference_median(series.logits[start..=end].to_vec());
                        let mad = reference_median(
                            series.logits[start..=end]
                                .iter()
                                .map(|value| (value - logit_median).abs())
                                .collect(),
                        );
                        let score =
                            (series.logits[index] - logit_median) / (1.4826 * mad + epsilon);
                        assert_eq!(
                            series.probability_medians[index].to_bits(),
                            probability_median.to_bits(),
                            "median count={count} radius={radius} frame={index}"
                        );
                        assert_eq!(
                            series.robust_scores[index].to_bits(),
                            score.to_bits(),
                            "score count={count} radius={radius} frame={index}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn indexed_nms_matches_greedy_reference_at_distance_and_integer_edges() {
        let mut seed = 7u32;
        let events = (0..2048)
            .map(|index| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let time_us = if index % 31 == 0 {
                    i64::MAX - index as i64
                } else {
                    (seed as i64) % 3000
                };
                ScoredEvent {
                    interval: EventInterval { start: 0, end: 0 },
                    cut_frame: index,
                    time_us,
                    peak_probability: (index % 7) as f64 / 7.0,
                    robust_prominence: (index % 3) as f64,
                    area: 1.0,
                    width: 1,
                    strength: (index % 11) as f64 / 11.0,
                }
            })
            .collect::<Vec<_>>();
        for distance in [0, 1, 2, 3, 50, i64::MAX] {
            let mut sorted = events.clone();
            sorted.sort_by(compare_event_priority);
            let mut expected = Vec::<ScoredEvent>::new();
            for event in sorted {
                if !expected.iter().any(|known| {
                    distance > 0 && known.time_us.abs_diff(event.time_us) < distance as u64
                }) {
                    expected.push(event);
                }
            }
            expected.sort_by_key(|event| event.cut_frame);
            let actual = non_maximum_suppression(events.clone(), distance);
            assert_eq!(actual.len(), expected.len());
            for (actual, expected) in actual.iter().zip(&expected) {
                assert_eq!(actual.time_us, expected.time_us);
                assert_eq!(actual.cut_frame, expected.cut_frame);
                assert_eq!(
                    compare_event_priority(actual, expected),
                    std::cmp::Ordering::Equal
                );
            }
        }
    }

    fn default_config() -> StoryboardDecisionConfig {
        let config = StoryboardDecisionConfig::default();
        config.validate().expect("default config must be valid");
        config
    }

    #[test]
    fn isolated_peak_becomes_one_event_cut() {
        let mut predictions = vec![0.01; 120];
        predictions[60] = 0.9;

        let cuts = detect(predictions);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].cut_frame, 60);
        assert_eq!(cuts[0].event_start, 60);
        assert_eq!(cuts[0].event_end, 60);
        assert!(cuts[0].confidence > 0.5);
    }

    #[test]
    fn flat_high_sequence_has_no_robust_candidate() {
        let predictions = TransnetPredictions {
            single_frame: vec![0.9; 80],
            many_hot: vec![0.9; 80],
        };

        let cuts = detect_storyboard_cuts(&predictions, None, 25.0, &default_config());

        assert!(cuts.is_empty());
    }

    #[test]
    fn marginal_candidate_can_be_rejected_by_event_model() {
        let mut predictions = vec![0.01; 120];
        predictions[60] = 0.1;
        let config = default_config();
        let series = robust_series(&predictions, &config);

        let peaks = candidate_peaks(&series, &config);
        let cuts = detect(predictions);

        assert_eq!(peaks, vec![60]);
        assert!(cuts.is_empty());
    }

    #[test]
    fn concentrated_subthreshold_peak_is_rejected() {
        let mut predictions = vec![0.01; 120];
        predictions[60] = 0.13;

        let cuts = detect(predictions);

        assert!(cuts.is_empty());
    }

    #[test]
    fn wide_dissolve_hump_is_kept_at_its_mass_center() {
        let mut predictions = vec![0.01; 120];
        predictions[57..=63].copy_from_slice(&[0.2, 0.35, 0.6, 0.9, 0.6, 0.35, 0.2]);

        let cuts = detect(predictions);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].event_start, 57);
        assert_eq!(cuts[0].event_end, 63);
        assert_eq!(cuts[0].cut_frame, 60);
    }

    #[test]
    fn asymmetric_dissolve_cut_is_weighted_median_not_leftmost_peak() {
        let mut predictions = vec![0.01; 100];
        // Binary-exact excesses so half the mass falls on frame 43, after the
        // peak at 42 and after the first frame above the threshold at 41.
        predictions[40..47].copy_from_slice(&[0.25, 0.625, 1.0, 0.875, 0.75, 0.625, 0.25]);

        let cuts = detect(predictions);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].event_start, 40);
        assert_eq!(cuts[0].event_end, 46);
        assert_eq!(cuts[0].cut_frame, 43);
    }

    #[test]
    fn equal_peak_plateau_does_not_prefer_the_earliest_frame() {
        let mut predictions = vec![0.01; 80];
        predictions[39..=41].fill(0.9);

        let cuts = detect(predictions);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].event_start, 39);
        assert_eq!(cuts[0].event_end, 41);
        assert_eq!(cuts[0].cut_frame, 40);

        assert_eq!(weighted_median_index(&[0.4, 0.4]), 1);
        assert_eq!(weighted_median_index(&[0.4, 0.4, 0.4]), 1);
    }

    #[test]
    fn many_hot_head_accepts_and_localizes_a_gradual_transition() {
        let single_frame = vec![0.05; 120];
        let mut many_hot = vec![0.02; 120];
        many_hot[50..61].copy_from_slice(&[
            0.20, 0.35, 0.55, 0.70, 0.85, 0.95, 0.80, 0.60, 0.40, 0.25, 0.15,
        ]);

        let cuts = detect_storyboard_cuts(
            &TransnetPredictions {
                single_frame,
                many_hot,
            },
            None,
            25.0,
            &default_config(),
        );

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].cut_frame, 55);
    }

    #[test]
    fn hard_cut_stays_on_the_single_frame_peak_when_many_hot_is_wide() {
        let mut single_frame = vec![0.01; 120];
        let mut many_hot = vec![0.02; 120];
        single_frame[60] = 0.95;
        many_hot[57..=63].copy_from_slice(&[0.4, 0.6, 0.8, 0.9, 0.8, 0.6, 0.4]);

        let cuts = detect_storyboard_cuts(
            &TransnetPredictions {
                single_frame,
                many_hot,
            },
            None,
            25.0,
            &default_config(),
        );

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].cut_frame, 60);
    }

    #[test]
    fn bayes_cost_does_not_reject_a_threshold_peak() {
        let mut config = default_config();
        config.false_positive_cost = 100.0;
        config.false_negative_cost = 1.0;
        let mut predictions = vec![0.01; 120];
        predictions[60] = 0.9;

        let cuts = detect_storyboard_cuts(&predictions_of(predictions), None, 25.0, &config);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].cut_frame, 60);
    }

    #[test]
    fn adjacent_peak_candidates_merge_into_one_weighted_cut() {
        let mut predictions = vec![0.01; 100];
        predictions[40] = 0.9;
        predictions[41] = 0.95;
        predictions[42] = 0.92;

        let cuts = detect(predictions);

        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].cut_frame, 41);
        assert_eq!(cuts[0].event_start, 40);
        assert_eq!(cuts[0].event_end, 42);
    }

    #[test]
    fn identity_beta_calibration_preserves_probability() {
        let calibration = BetaCalibration {
            a: 1.0,
            b: 1.0,
            c: 0.0,
        };

        let calibrated = calibration.calibrate(0.73, 1.0e-9);

        assert!((calibrated - 0.73).abs() < 1.0e-8);
    }

    #[test]
    fn minimum_distance_and_short_shots_use_seconds() {
        let mut predictions = vec![0.01; 80];
        predictions[40] = 0.95;
        predictions[44] = 0.95;
        let predictions = predictions_of(predictions);

        let close = detect_storyboard_cuts(&predictions, None, 100.0, &default_config());
        let separated = detect_storyboard_cuts(&predictions, None, 10.0, &default_config());

        assert_eq!(
            close.iter().map(|cut| cut.cut_frame).collect::<Vec<_>>(),
            vec![40]
        );
        assert_eq!(
            separated
                .iter()
                .map(|cut| cut.cut_frame)
                .collect::<Vec<_>>(),
            vec![40, 44]
        );
    }

    #[test]
    fn short_shot_constraint_is_soft_and_uses_last_accepted_cut() {
        let config = default_config();
        let event = |cut_frame, time_us, strength| ScoredEvent {
            interval: EventInterval {
                start: cut_frame,
                end: cut_frame,
            },
            cut_frame,
            time_us,
            peak_probability: strength,
            robust_prominence: 10.0,
            area: strength,
            width: 1,
            strength,
        };

        let cuts = apply_short_shot_constraint(
            vec![
                event(20, 800_000, 0.9),
                event(21, 840_000, 0.8),
                event(40, 1_600_000, 0.9),
            ],
            &config,
        );

        assert_eq!(
            cuts.iter().map(|cut| cut.cut_frame).collect::<Vec<_>>(),
            vec![20, 40]
        );
        assert_eq!(cuts[0].confidence, 0.9);
        assert!(cuts[1].confidence < 0.9);
        assert!(cuts[1].confidence > 0.5);
    }

    #[test]
    fn nms_uses_strength_then_peak_then_prominence_then_time() {
        let event = |cut_frame, time_us, strength, peak_probability, prominence| ScoredEvent {
            interval: EventInterval {
                start: cut_frame,
                end: cut_frame,
            },
            cut_frame,
            time_us,
            peak_probability,
            robust_prominence: prominence,
            area: peak_probability,
            width: 1,
            strength,
        };

        let retained = non_maximum_suppression(
            vec![
                event(10, 400_000, 0.8, 0.9, 10.0),
                event(11, 440_000, 0.9, 0.8, 9.0),
                event(20, 800_000, 0.7, 0.7, 7.0),
            ],
            120_000,
        );

        assert_eq!(
            retained
                .iter()
                .map(|candidate| candidate.cut_frame)
                .collect::<Vec<_>>(),
            vec![11, 20]
        );
    }
}
