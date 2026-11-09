"use client";

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";

/** Read again after a minute: an account connected or removed in Settings shows on the next cards. */
const FRESH_MS = 60_000;
/** A failed read is tried again this often, a few times, so a card on screen does not stay without its actions. */
const RETRY_MS = 5_000;
const RETRIES = 3;
let cached: { at: number; platforms: Promise<ReadonlySet<string>> } | null = null;

/**
 * The platforms with a connected account (`GET /api/v1/accounts`), shared by the cards on screen. Null until known (or
 * when the read failed), so a card never offers "I posted it" for an account that turns out to be connected; the
 * server refuses that case too (`cmo_post_myself`).
 */
export function useConnectedPlatforms(skip = false): ReadonlySet<string> | null {
  const [platforms, setPlatforms] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (attempt: number) => {
      if (!cached || Date.now() - cached.at > FRESH_MS) {
        const platforms = api<{ platforms: string[] }>("/accounts").then((body) => new Set(body.platforms) as ReadonlySet<string>);
        // A failed read is not kept: the next attempt, or the next card, asks again.
        platforms.catch(() => {
          if (cached?.platforms === platforms) cached = null;
        });
        cached = { at: Date.now(), platforms };
      }
      cached.platforms
        .then((set) => live && setPlatforms(set))
        .catch(() => {
          if (live && attempt < RETRIES) timer = setTimeout(() => read(attempt + 1), RETRY_MS);
        });
    };
    read(1);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [skip]);
  return platforms;
}
