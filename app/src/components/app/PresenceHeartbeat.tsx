"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

/** Keeps `presence.lastSeenAt` fresh while the tab is visible (30 s). */
export function PresenceHeartbeat() {
  const heartbeat = useMutation(api.presence.heartbeat);
  useEffect(() => {
    let cancelled = false;
    const beat = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      void heartbeat({}).catch(() => undefined);
    };
    beat();
    const interval = window.setInterval(beat, 30_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [heartbeat]);
  return null;
}
