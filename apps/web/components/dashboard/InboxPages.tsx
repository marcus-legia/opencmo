"use client";

import Link from "next/link";

import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { Button, EmptyState, MonoLabel } from "@/components/ui";

import { ApprovalQueue } from "./ApprovalQueue";
import { SAMPLE_KIT } from "./sample";
import { useDashboard } from "./useDashboard";

function Status({ state, reload }: { state: ReturnType<typeof useDashboard>["state"]; reload: () => void }) {
  if (state.status === "loading") return <p className="v2-muted" aria-busy="true">Loading…</p>;
  return (
    <div className="v2-empty" role="alert">
      <b className="v2-empty-title">The queue did not load.</b>
      <span className="v2-empty-text">{state.status === "error" ? state.message : null}</span>
      <div className="v2-actions">
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function InboxQueue() {
  const { state, view, decideCard, reload } = useDashboard();
  return (
    <div className="v2-page v2-inbox">
      {view ? <ApprovalQueue cards={view.queue} live={view.live.queue} nextCard={view.nextCard} onDecide={decideCard} /> : <Status state={state} reload={() => void reload()} />}
    </div>
  );
}

export function InboxCardPage({ id }: { id: string }) {
  const { state, view, decideCard, reload } = useDashboard();
  if (!view) {
    return (
      <div className="v2-page v2-inbox">
        <Status state={state} reload={() => void reload()} />
      </div>
    );
  }
  // The component sheet's other kinds and states exist only in the fixture, so only a sample Dashboard looks there.
  const card = view.queue.find((c) => c.id === id) ?? (view.live.queue ? undefined : SAMPLE_KIT.find((c) => c.id === id));

  return (
    <div className="v2-page v2-inbox" data-testid="inbox-card-page">
      <Link href="/app" className="v2-back">
        ← Dashboard
      </Link>
      {card ? (
        <ApprovalCard card={card} onDecide={decideCard} headingLevel="h2" />
      ) : (
        <EmptyState title="This card is no longer waiting." action={<Link href="/app">Open the queue</Link>}>
          You or your CMO decided it, or it expired. Whatever still waits is on the Dashboard.
        </EmptyState>
      )}
      <MonoLabel small muted>
        Links from the morning email open a card; deciding always happens here.
      </MonoLabel>
    </div>
  );
}
