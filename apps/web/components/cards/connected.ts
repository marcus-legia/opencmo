"use client";

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";

let cached: Promise<ReadonlySet<string>> | null = null;

/**
 * The platforms with a connected account, read once per page load (`GET /api/v1/accounts`). Null until known, so a card
 * never offers "I posted it" for an account that turns out to be connected.
 */
export function useConnectedPlatforms(skip = false): ReadonlySet<string> | null {
  const [platforms, setPlatforms] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    cached ??= api<{ platforms: string[] }>("/accounts").then(
      (body) => new Set(body.platforms),
      (error: unknown) => {
        cached = null;
        throw error;
      },
    );
    cached.then((set) => live && setPlatforms(set)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [skip]);
  return platforms;
}
