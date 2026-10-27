"use client";

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";

import type { ScreenName } from "./nav";

type ScreensIndex = { live: Partial<Record<ScreenName, boolean>> };

/**
 * Which v2 screens have live data, from the screens route (Session A, U0). Until the route answers, nothing counts
 * as live: in production that hides every sample-only screen, which is the safe side.
 */
export function useScreensLive(): Partial<Record<ScreenName, boolean>> {
  const [live, setLive] = useState<Partial<Record<ScreenName, boolean>>>({});
  useEffect(() => {
    let cancelled = false;
    api<ScreensIndex>("/screens")
      .then((index) => {
        if (!cancelled && index && typeof index.live === "object") setLive(index.live);
      })
      .catch(() => {
        // A hint for the rail only: keep the safe default.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return live;
}
