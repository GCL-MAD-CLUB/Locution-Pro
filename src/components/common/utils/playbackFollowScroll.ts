/** Finish centering before playback leaves the target, including very short items. */
export function playbackFollowScrollDuration(
  distance: number,
  viewportHeight: number,
  currentFrame: number,
  startFrame: number,
  endFrame: number,
  frameRate: number,
) {
  const remainingMs = (Math.max(0, endFrame - 1 - currentFrame) / frameRate) * 1000;
  const preferredMs =
    currentFrame < startFrame
      ? Math.min(1200, Math.max(1000, ((startFrame - 1 - currentFrame) / frameRate) * 1000))
      : Math.min(900, 180 + Math.sqrt(Math.abs(distance) / Math.max(1, viewportHeight)) * 300);
  // Leave a paint frame for arrival. One-frame items must center immediately.
  return Math.max(0, Math.min(preferredMs, remainingMs - 1000 / 60));
}

interface ScrollAnimationClock {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
}

const browserClock: ScrollAnimationClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/** Cache geometry at the start; animation frames only write the scroll position. */
export function animatePlaybackFollowScroll(
  element: Pick<HTMLElement, "scrollTop">,
  targetOffset: number,
  duration: number,
  clock: ScrollAnimationClock = browserClock,
) {
  const startOffset = element.scrollTop;
  const distance = targetOffset - startOffset;
  if (Math.abs(distance) < 1 || duration <= 0) {
    element.scrollTop = targetOffset;
    return () => {};
  }
  const startedAt = clock.now();
  let frame: number | null = null;
  const animate = (timestamp: number) => {
    const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / duration));
    const eased =
      progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    element.scrollTop = startOffset + distance * eased;
    frame = progress < 1 ? clock.requestFrame(animate) : null;
  };
  frame = clock.requestFrame(animate);
  return () => {
    if (frame !== null) {
      clock.cancelFrame(frame);
      frame = null;
    }
  };
}
