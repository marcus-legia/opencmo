"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/components/clipping/api";
import { decide, decidedMessage, type Decision } from "@/components/cards/decide";
import { approvedLine, type ApprovalCardView } from "@/components/cards/model";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { DepartmentName } from "@/components/shell-v2/nav";

import type { DashboardView } from "./model";
import { sampleDashboard } from "./sample";

type ScreenResponse = { data: DashboardView };

export type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; view: DashboardView };

function isView(value: unknown): value is DashboardView {
  const view = value as DashboardView | null;
  return !!view && Array.isArray(view.queue) && Array.isArray(view.team) && Array.isArray(view.log) && typeof view.week === "object";
}

/**
 * The Dashboard's data and its one write: deciding a card. Shared by `/app` and `/app/inbox` so both show the same queue.
 *
 * Reads `GET /api/v1/screens/dashboard` (Session A, U0). Until that route exists it answers 404, and the fixture from
 * `sample.ts` stands in; this branch goes away with U0.
 */
export function useDashboard() {
  const { reportQueue, toast } = useShellState();
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  // Bumped by every decision: a read that started before it carries the old queue and must not overwrite it.
  const epoch = useRef(0);

  const load = useCallback(async () => {
    const started = epoch.current;
    try {
      const response = await api<ScreenResponse>("/screens/dashboard");
      if (!isView(response?.data)) throw new ApiError("The Dashboard could not be read. Try again in a moment.", 0, null);
      if (epoch.current === started) setState({ status: "ready", view: response.data });
    } catch (error) {
      if (epoch.current !== started) return;
      if (error instanceof ApiError && error.status === 404) setState({ status: "ready", view: sampleDashboard() });
      else setState({ status: "error", message: error instanceof ApiError ? error.message : "The Dashboard could not be read." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const view = state.status === "ready" ? state.view : null;

  // Every count on screen (rail badge, tab bar, headline, node chips) comes from this one queue.
  useEffect(() => {
    if (!view) return;
    const stuck = view.team.filter((node) => node.state === "stuck").map((node) => node.department);
    reportQueue(view.queue.filter((card) => card.state === "waiting").length, stuck);
  }, [view, reportQueue]);

  const decideCard = useCallback(
    async (card: ApprovalCardView, decision: Decision): Promise<boolean> => {
      if (state.status !== "ready") return false;
      const before = state.view;
      const line = {
        id: `you-${card.id}-${Date.now()}`,
        at: new Date().toISOString(),
        who: "you" as const,
        text: decision.action === "approve" ? approvedLine(card) : decision.action === "replied" ? approvedLine(card) : `You ${card.kind === "reply" ? "dismissed" : "skipped"}: ${card.title}`,
      };
      epoch.current += 1;
      setState({ status: "ready", view: { ...before, queue: before.queue.filter((c) => c.id !== card.id), log: [line, ...before.log] } });
      try {
        await decide(card, decision);
        toast(decidedMessage(card, decision));
        return true;
      } catch (error) {
        epoch.current += 1;
        // Put the card back where it was; the other cards may have moved meanwhile, so restore by id, not by snapshot.
        setState((current) => {
          if (current.status !== "ready") return current;
          const queue = current.view.queue.some((c) => c.id === card.id) ? current.view.queue : [...current.view.queue];
          if (!queue.some((c) => c.id === card.id)) {
            const index = before.queue.findIndex((c) => c.id === card.id);
            queue.splice(Math.min(Math.max(0, index), queue.length), 0, card);
          }
          return { status: "ready", view: { ...current.view, queue, log: current.view.log.filter((event) => event.id !== line.id) } };
        });
        toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
        return false;
      }
    },
    [state, toast],
  );

  const waiting = useCallback(
    (department: DepartmentName) => (view ? view.queue.filter((card) => card.state === "waiting" && card.department === department).length : 0),
    [view],
  );

  return { state, view, decideCard, waiting, reload: load };
}
