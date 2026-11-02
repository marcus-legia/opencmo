"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/components/clipping/api";
import { useLive } from "@/components/clipping/useLive";
import { useShellAccount } from "@/components/clipping/web/WebShell";
import { decide, decidedMessage, type Decision } from "@/components/cards/decide";
import { approvedLine } from "@/components/cards/labels";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { ApprovalCard } from "@/lib/screens/approval-card";
import type { Department } from "@/lib/screens/common";
import type { ScreenResponse } from "@/lib/screens/registry";

type Response = ScreenResponse<"dashboard">;

export type DashboardState = { status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & Response);

/** `?sample=1` on the page asks the route for the pure fixture (look checks; refused in production). */
function screenPath(): string {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sample") === "1" ? "/screens/dashboard?sample=1" : "/screens/dashboard";
}

/**
 * The Dashboard's data (`GET /api/v1/screens/dashboard`, `DashboardScreen`) and its one write: deciding a card.
 * Shared by `/app` and `/app/inbox`, so both show the same queue. New cards and log lines arrive through
 * Realtime on `approvals` and `work_order_events`, which trigger a re-read under RLS.
 */
export function useDashboard() {
  const { reportQueue, toast } = useShellState();
  const { userId } = useShellAccount();
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  // Bumped by every decision: a read that started before it carries the old queue and must not overwrite it.
  const epoch = useRef(0);

  const load = useCallback(async () => {
    const started = epoch.current;
    try {
      const response = await api<Response>(screenPath());
      if (epoch.current === started) setState({ status: "ready", ...response });
    } catch (error) {
      if (epoch.current !== started) return;
      setState((current) =>
        // A failed refresh keeps what is on screen; only the first read shows the error.
        current.status === "ready" ? current : { status: "error", message: error instanceof ApiError ? error.message : "The Dashboard could not be read." },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const realtime = state.status === "ready" && state.live.queue;
  const filter = userId ? `user_id=eq.${userId}` : null;
  useLive("approvals", filter, () => void load(), realtime, false, "dashboard");
  useLive("work_order_events", filter, () => void load(), realtime && state.live.log, false, "dashboard");

  const ready = state.status === "ready" ? state : null;
  const queue = ready?.data.queue;
  const nodes = ready?.data.team.nodes;

  // Every count on screen (rail badge, tab bar, headline, node chips) comes from this one queue.
  useEffect(() => {
    if (!queue || !nodes) return;
    const stuck = nodes.filter((node) => node.state === "stuck").map((node) => node.department);
    reportQueue(queue.filter((card) => card.status === "waiting").length, stuck);
  }, [queue, nodes, reportQueue]);

  const decideCard = useCallback(
    async (card: ApprovalCard, decision: Decision): Promise<boolean> => {
      if (state.status !== "ready") return false;
      const before = state;
      const sample = !before.live.queue;
      const line = {
        id: `you-${card.id}-${Date.now()}`,
        at: new Date().toISOString(),
        who: "you" as const,
        text: decision.action === "approve" || decision.action === "edit" || decision.action === "replied" ? approvedLine(card) : `You set aside: ${card.title}`.slice(0, 200),
      };
      epoch.current += 1;
      setState({ ...before, data: { ...before.data, queue: before.data.queue.filter((c) => c.id !== card.id), log: [line, ...before.data.log].slice(0, 50) } });
      try {
        await decide(card, decision, sample);
        toast(decidedMessage(card, decision, sample));
        if (!sample) void load();
        return true;
      } catch (error) {
        epoch.current += 1;
        // Put the card back where it was; other cards may have moved meanwhile, so restore by id, not by snapshot.
        setState((current) => {
          if (current.status !== "ready") return current;
          const queue = [...current.data.queue];
          if (!queue.some((c) => c.id === card.id)) {
            const index = before.data.queue.findIndex((c) => c.id === card.id);
            queue.splice(Math.min(Math.max(0, index), queue.length), 0, card);
          }
          return { ...current, data: { ...current.data, queue, log: current.data.log.filter((event) => event.id !== line.id) } };
        });
        toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
        // A changed or already decided card: read the queue again so the founder sees what is true now.
        if (error instanceof ApiError && error.status !== 0) void load();
        return false;
      }
    },
    [state, toast, load],
  );

  const setPausedAt = useCallback((pausedAt: string | null) => {
    setState((current) => (current.status === "ready" ? { ...current, data: { ...current.data, cmo: { ...current.data.cmo, pausedAt } } } : current));
  }, []);

  /** Waiting cards per department, from the queue on screen, so the chips move with every decision. */
  const waiting = useCallback(
    (department: Department) => (queue ? queue.filter((card) => card.status === "waiting" && card.department === department).length : 0),
    [queue],
  );

  return { state, decideCard, waiting, setPausedAt, reload: load };
}
