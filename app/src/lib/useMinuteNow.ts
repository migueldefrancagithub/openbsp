"use client";

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * Minute-aligned client clock for reactive Convex projections. Starting at
 * null keeps server and first-client renders identical during hydration.
 */
export function useMinuteNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      timeout = setTimeout(tick, MINUTE_MS - (current % MINUTE_MS) + 25);
    };

    tick();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return now;
}
