"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { applyColumns, CHAT, clamp, DEFAULT_COLUMNS, KEY, LEFT, parseColumns, type TodayColumns } from "./columns-boot";

export { CHAT, LEFT } from "./columns-boot";

/** The chosen widths, and how to change them live (during a drag) or for good (on release, by keyboard). */
export function useTodayColumns() {
  const [columns, setColumns] = useState<TodayColumns>(DEFAULT_COLUMNS);
  const current = useRef(columns);
  current.current = columns;
  useEffect(() => {
    try {
      setColumns(parseColumns(localStorage.getItem(KEY)));
    } catch {
      // Storage off: the defaults the boot script already applied.
    }
  }, []);

  const live = useCallback((side: keyof TodayColumns, value: number) => {
    document.documentElement.style.setProperty(side === "left" ? "--td-col-left" : "--td-col-chat", `${value}px`);
  }, []);

  // Each sash (Feed's, the shell's) holds its own copy: re-read the stored pair so one side never writes the other's
  // stale width back.
  const commit = useCallback((side: keyof TodayColumns, value: number) => {
    let stored = DEFAULT_COLUMNS;
    try {
      stored = parseColumns(localStorage.getItem(KEY));
    } catch {
      stored = current.current;
    }
    const next = { ...stored, [side]: clamp(value, side === "left" ? LEFT : CHAT) };
    applyColumns(next);
    setColumns(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode: the widths last for this page.
    }
  }, []);

  return { columns, live, commit };
}
