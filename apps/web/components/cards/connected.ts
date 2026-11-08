"use client";

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";

/** Read again after a minute: an account connected or removed in Settings shows on the next cards. */
const FRESH_MS = 60_000;
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
    if (!cached || Date.now() - cached.at > FRESH_MS) {
      const platforms = api<{ platforms: string[] }>("/accounts").then((body) => new Set(body.platforms) as ReadonlySet<string>);
      // A failed read is not kept: the next card asks again.
      platforms.catch(() => {
        if (cached?.platforms === platforms) cached = null;
      });
      cached = { at: Date.now(), platforms };
    }
    cached.platforms.then((set) => live && setPlatforms(set)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [skip]);
  return platforms;
}
