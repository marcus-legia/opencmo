"use client";

import { useEffect, useState } from "react";

import { ApprovalCard, type DecideHandler } from "@/components/cards/ApprovalCard";
import type { ApprovalCardView } from "@/components/cards/model";
import { EmptyState, SampleTag } from "@/components/ui";

/** The only approval queue: one card open, the rest collapsed to their head and title. */
export function ApprovalQueue({
  cards,
  live,
  nextCard,
  onDecide,
}: {
  cards: ApprovalCardView[];
  live: boolean;
  nextCard: string | null;
  onDecide: DecideHandler;
}) {
  const [open, setOpen] = useState<string | null>(cards[0]?.id ?? null);
  // A decided card leaves; the next one opens so the founder can keep going.
  useEffect(() => {
    if (!cards.some((card) => card.id === open)) setOpen(cards[0]?.id ?? null);
  }, [cards, open]);
  const count = cards.filter((card) => card.state === "waiting").length;

  return (
    <aside aria-labelledby="wait-title" className="v2-queue" data-testid="approval-queue">
      <div className="v2-queue-head">
        <h2 id="wait-title" className="v2-panel-title">
          <span className="v2-mark is-small" aria-hidden="true" />
          Waiting on you · <span data-testid="queue-count">{count}</span>
          {live ? null : <SampleTag />}
        </h2>
        <span className="v2-queue-note">The only approval queue</span>
      </div>
      {cards.length === 0 ? (
        <EmptyState title="Nothing waits on you.">{nextCard ?? "Your team keeps working. The next card lands here and in the morning email."}</EmptyState>
      ) : (
        cards.map((card) => (
          <ApprovalCard key={card.id} card={card} onDecide={onDecide} open={card.id === open} onToggle={() => setOpen(card.id === open ? null : card.id)} />
        ))
      )}
    </aside>
  );
}
