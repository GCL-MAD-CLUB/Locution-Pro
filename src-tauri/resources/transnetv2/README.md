# Shot detection assets

Maintainer resource reference for Locution Pro 0.4.2. Shot detection operates on
video pictures and does not require subtitle tracks.

## Preparation

Run `npm run prepare:transnetv2` from the repository root. Required resources are:

- transnetv2.onnx
- storyboard-event-model.json
- onnxruntime.dll
- DirectML.dll

Preparation also copies the corresponding license and notice files. Keep resource
provenance separate from product help; see
[third-party notices](../../../THIRD_PARTY_NOTICES).

## Detection contracts

The model input remains fixed at `[1, 100, 27, 48, 3]`. Concurrent detections
share a serialized inference session and reusable input tensor, rather than
changing model batch dimensions. The session stays warm for 30 seconds after
its last task.

DirectML is preferred when usable, with shared CPU inference recovery.
Windows FFmpeg extraction separately requests D3D11VA decoding; driver, build
and codec compatibility must be verified independently of inference availability.

The ONNX graph has two sigmoid heads, both shaped `[1, 100, 1]`:

- `534` is the single-frame head (a narrow peak is a hard cut)
- `535` is the many-hot head (frames that belong to a gradual transition)

Windows still advance by 50 frames and keep predictions 25 through 74. The
decision reads both heads. Robust local median and MAD still find candidate
peaks and expand each event. A single-frame probability near 0.5 accepts a
cut, including a wide dissolve; the many-hot head or enough single-frame mass
accepts a gradual transition that the single-frame head does not peak above
that threshold. A flat high sequence with no local contrast is not a cut.
Inside an accepted interval the cut is the weighted median of excess
probability, using the head that localizes the transition. Shots stay
contiguous: the previous shot ends on that frame and the next starts on the
following frame.

`storyboard-event-model.json` is marked `threshold_rules_uncalibrated`. Its
classifier coefficients are retained so the file shape stays stable, and they
are not a fitted or calibrated accept/reject rule. A learned replacement still
needs labeled transitions and a separate calibration set.

Decoded frames keep their presentation timestamps. Shot `start_us` /
`end_us` use those timestamps when every decoded frame has one. A non-final
shot ends at the next frame's timestamp, so adjacent shots meet. The last
shot ends at the media duration. If timestamps are missing, non-monotonic, or
not aligned 1:1 with the prediction sequence, shot times fall back to a
constant frame rate and still meet on the next frame boundary.

Bounded queues, cancellation, stale result rejection and storage requirements
are maintained in [media processing](../../../docs/media-processing.md).
