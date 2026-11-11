"use client";

import { useCallback } from "react";

import type { DecideHandler } from "@/components/cards/ApprovalCard";
import { decide, decidedMessage } from "@/components/cards/decide";
import { ApiError } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";

/** A decision made outside the feed (Calendar, agent pages): the same route and messages, then the screen reloads. */
export function useDecide(sample: boolean, reload: () => void): DecideHandler {
  const { toast } = useShellState();
  return useCallback(
    async (card, decision) => {
      try {
        await decide(card, decision, sample);
        toast(decidedMessage(card, decision, sample));
        reload();
        return true;
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "That did not go through. Please try again.");
        return false;
      }
    },
    [sample, reload, toast],
  );
}
