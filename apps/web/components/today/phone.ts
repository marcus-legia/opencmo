"use client";

import { useSyncExternalStore } from "react";

/** The width the canvas's phone boards are drawn for and below (wave 4 C1); the CSS uses the same 640 px line. */
const PHONE = "(max-width: 640px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a phone-width window. The server and the first paint say false: the phone layout starts once mounted. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}
