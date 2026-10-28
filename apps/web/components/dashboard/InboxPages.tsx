"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { decide, decidedMessage, type Decision } from "@/components/cards/decide";
import { ApiError, api } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";
import { Button, EmptyState, MonoLabel } from "@/components/ui";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";

import { ApprovalQueue } from "./ApprovalQueue";
import { useDashboard } from "./useDashboard";

function Failed({ message, reload }: { message: string; reload: () => void }) {
  return (
    <div className="v2-empty" role="alert">
      <b className="v2-empty-title">The queue did not load.</b>
      <span className="v2-empty-text">{message}</span>
      <div className="v2-actions">
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** The phone's Approve tab: the Dashboard queue on its own. */
export function InboxQueue() {
  const { state, decideCard, reload } = useDashboard();
  return (
    <div className="v2-page v2-inbox">
      {state.status === "ready" ? (
        <ApprovalQueue cards={state.data.queue} live={state.live.queue} digest={null} onDecide={decideCard} />
      ) : state.status === "error" ? (
        <Failed message={state.message} reload={() => void reload()} />
      ) : (
        <p className="v2-muted" aria-busy="true">
          Loading…
        </p>
      )}
    </div>
  );
}

type One = { status: "loading" } | { status: "missing" } | { status: "error"; message: string } | { status: "ready"; card: Card; sample: boolean };

/**
 * One card on its own page (`GET /api/v1/approvals/[id]`): the digest and reminders link here, and they never
 * decide. `sampleCard` is a fixture the server resolved for a `card-…` id, outside production only.
 */
export function InboxCardPage({ id, sampleCard }: { id: string; sampleCard: Card | null }) {
  const { toast } = useShellState();
  const [state, setState] = useState<One>({ status: "loading" });

  const load = useCallback(async () => {
    if (sampleCard) return setState({ status: "ready", card: sampleCard, sample: true });
    try {
      setState({ status: "ready", card: await api<Card>(`/approvals/${encodeURIComponent(id)}`), sample: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setState({ status: "missing" });
      else setState({ status: "error", message: error instanceof ApiError ? error.message : "The card could not be read." });
    }
  }, [id, sampleCard]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDecide = useCallback(
    async (card: Card, decision: Decision) => {
      const sample = state.status === "ready" && state.sample;
      try {
        const next = await decide(card, decision, sample);
        toast(decidedMessage(card, decision, sample));
        // The card stays on this page in its decided state, so the founder sees what happened.
        setState({ status: "ready", card: next ?? { ...card, status: decision.action === "approve" || decision.action === "edit" || decision.action === "replied" ? "approved" : "skipped" }, sample });
        return true;
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
        void load();
        return false;
      }
    },
    [state, toast, load],
  );

  return (
    <div className="v2-page v2-inbox" data-testid="inbox-card-page">
      <Link href="/app" className="v2-back">
        ← Dashboard
      </Link>
      {state.status === "ready" ? (
        <ApprovalCard key={`${state.card.id}-${state.card.status}`} card={state.card} sample={state.sample} onDecide={onDecide} headingLevel="h2" />
      ) : state.status === "missing" ? (
        <EmptyState title="This card is no longer here." action={<Link href="/app">Open the queue</Link>}>
          It may have been replaced by a newer version. Whatever still waits is on the Dashboard.
        </EmptyState>
      ) : state.status === "error" ? (
        <Failed message={state.message} reload={() => void load()} />
      ) : (
        <p className="v2-muted" aria-busy="true">
          Loading…
        </p>
      )}
      <MonoLabel small muted>
        Links from the morning email open a card; deciding always happens here.
      </MonoLabel>
    </div>
  );
}
