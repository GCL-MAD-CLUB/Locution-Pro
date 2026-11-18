import { repeatEvery, cancelTask } from "../scheduling";
import { useState } from "react";
import type { RenderLifetime } from "../lifetime/RenderLifetime";

/** Sample wall time after commit; renders consume a cached snapshot. */
export function useClock(lifetime: RenderLifetime) {
  const [now, setNow] = useState(0);
  lifetime.useBeforePaint(() => {
    const sample = () => setNow(Date.now());
    sample();
    const timer = repeatEvery(sample, 60_000);
    return () => cancelTask(timer);
  }, []);
  return now;
}
