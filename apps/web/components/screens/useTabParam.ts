"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * A tab (or any one-of value) kept in the URL, so a link or Back opens the same tab. Written with
 * `replaceState`: switching a tab must not cost a server render.
 */
export function useTabParam<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const params = useSearchParams();
  const initial = params.get(key);
  const [value, setValue] = useState<T>(allowed.includes(initial as T) ? (initial as T) : fallback);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(window.history.state, "", url);
    },
    [key, fallback],
  );
  return [value, set];
}
