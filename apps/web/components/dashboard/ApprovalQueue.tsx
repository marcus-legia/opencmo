"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApprovalCard, type DecideHandler } from "@/components/cards/ApprovalCard";
import { EmptyState, SampleTag } from "@/components/ui";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import { DEPARTMENT_LABEL } from "@/lib/screens/common";
import type { DashboardScreen } from "@/lib/screens/dashboard";

/** The morning digest at the top of the queue: what waits (each opens its card), what went out, what is stuck. */
function Digest({ digest }: { digest: NonNullable<DashboardScreen["digest"]> }) {
  return (
    <details className="v2-digest" data-testid="digest">
      <summary>
        <span className="v2-mono is-small is-muted">Morning digest · {digest.dateLabel}</span>
      </summary>
      <div className="v2-digest-body">
        {digest.waiting.length > 0 ? (
          <div>
            <b>Waiting on you</b>
            <ul>
              {digest.waiting.map((item) => (
                <li key={item.id}>
                  <Link href={`/app/inbox/${encodeURIComponent(item.id)}`}>{item.title}</Link> <span className="v2-muted">· {DEPARTMENT_LABEL[item.department]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {digest.wentOut.length > 0 ? (
          <div>
            <b>Went out</b>
            <ul>
              {digest.wentOut.map((item, index) => (
                <li key={index}>
                  {item.title} <span className="v2-muted">· {item.where}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {digest.stuck.length > 0 ? (
          <div>
            <b>Stuck</b>
            <ul>
              {digest.stuck.map((item, index) => (
                <li key={index}>
                  {item.title} <span className="v2-muted">· {DEPARTMENT_LABEL[item.department]}: {item.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** The only approval queue: one card open, the rest collapsed to their head and title. */
export function ApprovalQueue({
  cards,
  live,
  digest,
  onDecide,
}: {
  cards: Card[];
  live: boolean;
  digest: DashboardScreen["digest"];
  onDecide: DecideHandler;
}) {
  const [open, setOpen] = useState<string | null>(cards[0]?.id ?? null);
  // A decided card leaves; the next one opens so the founder can keep going.
  useEffect(() => {
    if (open !== null && !cards.some((card) => card.id === open)) setOpen(cards[0]?.id ?? null);
  }, [cards, open]);
  const count = cards.filter((card) => card.status === "waiting").length;

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
      {digest ? <Digest digest={digest} /> : null}
      {cards.length === 0 ? (
        <EmptyState title="Nothing waits on you.">Your team keeps working. The next card lands here and in the morning email.</EmptyState>
      ) : (
        cards.map((card) => (
          <ApprovalCard
            key={card.id}
            card={card}
            sample={!live}
            onDecide={onDecide}
            open={card.id === open}
            onToggle={() => setOpen(card.id === open ? null : card.id)}
          />
        ))
      )}
    </aside>
  );
}
