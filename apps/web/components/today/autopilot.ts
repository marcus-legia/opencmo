"use client";

import { useEffect } from "react";

import type { Autopilot } from "@/lib/screens/settings";

/**
 * Autopilot's state lives in two places on one screen: the top bar's switch and the Settings block in the centre.
 * Each read it from its own copy of the settings screen, so a change in one is told to the other here instead of
 * waiting for a reload.
 */
const EVENT = "opencmo:autopilot";

export function publishAutopilot(value: Autopilot): void {
  window.dispatchEvent(new CustomEvent<Autopilot>(EVENT, { detail: value }));
}

export function useAutopilotChanges(onChange: (value: Autopilot) => void): void {
  useEffect(() => {
    const listener = (event: Event) => onChange((event as CustomEvent<Autopilot>).detail);
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, [onChange]);
}
