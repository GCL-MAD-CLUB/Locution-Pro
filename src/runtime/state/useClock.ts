import { useState } from "react";
import type { RenderLifetime } from "../lifetime/RenderLifetime";

/** Sample wall time after commit; renders consume a cached snapshot. */
export function useClock(lifetime: RenderLifetime) {
  const [now, setNow] = useState(0);
  lifetime.useBeforePaint(() => {
    const sample = () => setNow(Date.now());
    sample();
    const timer = window.setInterval(sample, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
