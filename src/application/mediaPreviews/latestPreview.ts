/** One request in flight per preview. Pointer movement replaces pending work,
 * and obsolete results never reach the view. No work runs while the pointer is idle.
 */
export function createLatestPreview<Input, Output>(
  load: (input: Input) => Promise<Output>,
  publish: (output: Output) => void,
  onFailure: (error: unknown) => void,
) {
  let disposed = false;
  let running = false;
  let version = 0;
  let pending: { input: Input; version: number } | undefined;

  async function drain() {
    running = true;
    try {
      while (!disposed && pending) {
        const request = pending;
        pending = undefined;
        try {
          const result = await load(request.input);
          if (!disposed && request.version === version) publish(result);
        } catch (error) {
          if (!disposed && request.version === version) onFailure(error);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    request(input: Input) {
      if (disposed) return;
      pending = { input, version: ++version };
      if (!running) void drain();
    },
    dispose() {
      disposed = true;
      pending = undefined;
    },
  };
}

export function previewTimeUs(duration: number, progress: number | null, step: number) {
  if (
    progress === null ||
    !Number.isFinite(progress) ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return null;
  return Math.min(
    Math.floor((duration * Math.max(0, Math.min(1, progress))) / step) * step,
    Math.max(0, duration - step),
  );
}
