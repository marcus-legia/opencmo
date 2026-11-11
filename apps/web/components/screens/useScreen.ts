"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/components/clipping/api";
import { useOptionalShellState } from "@/components/shell-v2/ShellState";
import type { ScreenName, ScreenResponse } from "@/lib/screens/registry";

export type ScreenState<N extends ScreenName> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & ScreenResponse<N>);

/**
 * The last answer of each screen read in this tab, and the reads in flight. A screen opened again shows what it showed
 * last at once and reads again behind it (stale while revalidate): Feed, Calendar and Analytics switch without a
 * "Loading…" each time. Two hooks asking for the same screen at once (Calendar and the feed both read `dashboard`)
 * share one request. Per tab and in memory only: a sign-out is a full page load, which starts it empty.
 */
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 40;

function screenPath(name: ScreenName, key: string): string {
  const params = new URLSearchParams(key);
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sample") === "1") params.set("sample", "1");
  const qs = params.toString();
  return `/screens/${name}${qs ? `?${qs}` : ""}`;
}

function read<N extends ScreenName>(path: string): Promise<ScreenResponse<N>> {
  const running = inflight.get(path);
  if (running) return running as Promise<ScreenResponse<N>>;
  const request = api<ScreenResponse<N>>(path)
    .then((res) => {
      cache.delete(path);
      cache.set(path, res);
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return res;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}

/** Reads a screen ahead of its visit (a hover on its link, an idle moment): the visit then starts from the cache. */
export function prefetchScreen(name: ScreenName, query: Record<string, string> = {}): void {
  const path = screenPath(name, new URLSearchParams(query).toString());
  if (cache.has(path) || inflight.has(path)) return;
  void read(path).catch(() => {
    // A prefetch that fails changes nothing: the visit reads again and shows its own error.
  });
}

/**
 * Reads one v2 screen through `/api/v1/screens/[name]` (live fields + fixture, Session A's U0), under RLS like
 * every other client read. `?sample=1` on the page passes through, for the look checks of U9.
 */
export function useScreen<N extends ScreenName>(name: N, query: Record<string, string> = {}): [ScreenState<N>, () => void] {
  const key = new URLSearchParams(query).toString();
  const [state, setState] = useState<ScreenState<N>>(() => {
    const cached = typeof window === "undefined" ? undefined : cache.get(screenPath(name, key));
    return cached ? { status: "ready", ...(cached as ScreenResponse<N>) } : { status: "loading" };
  });
  const [tick, setTick] = useState(0);
  const shownKey = useRef(`${name}?${key}`);
  // Work the chat starts or shows (a scan, a draft, `view.open`) reloads the screen in column 3, not only the Dashboard.
  const work = useOptionalShellState()?.workVersion ?? 0;

  useEffect(() => {
    let alive = true;
    const path = screenPath(name, key);
    const cached = cache.get(path);
    // Another week or filter: its own cached answer, or loading; never the previous key's data under the new one.
    const keyChanged = shownKey.current !== `${name}?${key}`;
    shownKey.current = `${name}?${key}`;
    if (cached) setState({ status: "ready", ...(cached as ScreenResponse<N>) });
    else if (keyChanged) setState({ status: "loading" });
    // A reload (or new work) must not be answered by a read that started before it.
    if (tick > 0 || work > 0) inflight.delete(path);
    read<N>(path)
      .then((res) => alive && setState({ status: "ready", ...res }))
      .catch((err: unknown) => {
        // With something on screen already, a failed refresh keeps it rather than replacing the page with an error.
        if (alive && !cache.has(path)) setState({ status: "error", message: err instanceof Error ? err.message : "Could not load this page." });
      });
    return () => {
      alive = false;
    };
  }, [name, key, tick, work]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return [state, reload];
}

/** True when any of the given fields is still sample data: the page shows the "Sample data" tag. */
export function isSample(live: Record<string, boolean>, fields?: string[]): boolean {
  return (fields ?? Object.keys(live)).some((field) => !live[field]);
}
