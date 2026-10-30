"use client";

import { createContext, useContext } from "react";

import type { DepartmentName } from "./nav";

/**
 * Counts every v2 surface shows, owned by the shell so they agree: the rail badge, the phone tab, the Dashboard
 * headline and the team graph read the same number. The Dashboard reports its queue here after every decision.
 */
export type ShellState = {
  pending: number | null;
  stuck: DepartmentName[];
  reportQueue: (pending: number, stuck: DepartmentName[]) => void;
  toast: (message: string) => void;
  /** Puts the cursor in the CMO chat (column 2), opening it first where it is a drawer. */
  focusChat: () => void;
  /** Goes up each time the chat starts work, so a screen showing that work reloads. */
  workVersion: number;
};

export const ShellStateContext = createContext<ShellState | null>(null);

export function useShellState(): ShellState {
  const value = useContext(ShellStateContext);
  if (!value) throw new Error("useShellState must be used inside ShellV2");
  return value;
}
