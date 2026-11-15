import { useLayoutEffect, useRef, useState } from "react";

/** Shows the storyboard-style scrollbar thumb only while the pane actually overflows. */
export function useVerticalOverflow() {
  const ref = useRef<HTMLElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const next = element.scrollHeight > element.clientHeight + 1;
      setOverflow((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(element, { childList: true, characterData: true, subtree: true });
    measure();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);
  return { ref, overflow };
}
