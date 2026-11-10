"use client";

import Link from "next/link";
import { useState } from "react";

import { ApprovalCard, type DecideHandler } from "@/components/cards/ApprovalCard";
import { SampleTag } from "@/components/ui";
import { todayCountLine } from "@/lib/cmo/today";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import type { TodayData, TodayRowData } from "@/lib/screens/dashboard";

const LEVEL_LABEL: Record<TodayRowData["level"], string | null> = { critical: "Critical", high: "High", normal: null };

/**
 * Puts `prompt` in the CMO chat's box once `focusChat` has focused it. The chat owns its draft; setting the value the
 * way a keystroke would makes React's `onChange` take it, so the founder sees the request and sends it themselves
 * (the chat then shows its price card as usual). Nothing is sent from here. The chat may still be opening (a drawer
 * on a phone), so this looks for the focused box for up to two seconds.
 */
export function fillChat(prompt: string): void {
  const started = Date.now();
  const attempt = () => {
    const area = document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
    if (!area) {
      if (Date.now() - started < 2_000) window.setTimeout(attempt, 100);
      return;
    }
    if (area.value.trim()) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, prompt);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };
  window.setTimeout(attempt, 50);
}

/**
 * Today (CMO review 3, 1.1): at most five rows above the full queue. A card row opens the card in place, with the
 * actions it has in the queue; a silent platform with no post waiting asks the CMO for one; setup and first-run rows
 * link to their page. "N of M done today" counts the cards decided today plus the rows still open.
 */
export function TodayBlock({
  today,
  cards,
  live,
  onDecide,
  onAsk,
}: {
  today: TodayData;
  cards: Card[];
  live: boolean;
  onDecide: DecideHandler;
  onAsk: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const count = todayCountLine(today);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const rows = today.rows;

  return (
    <section aria-labelledby="today-title" className="td-today" data-testid="today">
      <div className="td-today-head">
        <h2 id="today-title" className="v2-panel-title">
          <span className="v2-mark is-small" aria-hidden="true" />
          Today
          {live ? null : <SampleTag />}
        </h2>
        {count ? (
          <span className="v2-mono is-muted" data-testid="today-count">
            {count}
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="td-today-empty v2-muted" data-testid="today-empty">
          {today.done > 0 ? "You are done for today. Your team keeps working." : "Nothing needs you today. Your team keeps working."}
        </p>
      ) : (
        <ol className="td-today-list">
          {rows.map((row) => {
            const card = row.action.type === "card" ? byId.get(row.action.approvalId) : undefined;
            const level = LEVEL_LABEL[row.level];
            const isOpen = card !== undefined && open === row.id;
            return (
              <li key={row.id} className={`td-today-row is-${row.level}`} data-testid="today-row" data-reason={row.reason}>
                <div className="td-today-line">
                  <div className="td-today-text">
                    <span className="td-today-title">
                      {level ? <span className={`v2-chip ${row.level === "critical" ? "is-stuck" : "is-waiting"}`}>{level}</span> : null}
                      {row.title}
                    </span>
                    {row.detail ? <span className="v2-muted td-today-detail">{row.detail}</span> : null}
                  </div>
                  {row.action.type === "card" ? (
                    card ? (
                      <button
                        type="button"
                        className="v2-button is-secondary is-compact"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : row.id)}
                      >
                        {isOpen ? "Close" : row.action.label}
                      </button>
                    ) : (
                      <Link className="v2-button is-secondary is-compact" href={`/app/inbox/${encodeURIComponent(row.action.approvalId)}`}>
                        {row.action.label}
                      </Link>
                    )
                  ) : row.action.type === "chat" ? (
                    <button
                      type="button"
                      className="v2-button is-secondary is-compact"
                      onClick={() => {
                        onAsk();
                        if (row.action.type === "chat") fillChat(row.action.prompt);
                      }}
                    >
                      {row.action.label}
                    </button>
                  ) : (
                    <Link className="v2-button is-secondary is-compact" href={row.action.href}>
                      {row.action.label}
                    </Link>
                  )}
                </div>
                {isOpen && card ? (
                  <div className="td-today-card">
                    <ApprovalCard card={card} sample={!live} onDecide={onDecide} open onToggle={() => setOpen(null)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {today.more > 0 ? (
        <a href="#approval-queue" className="v2-mono is-muted td-today-more" data-testid="today-more">
          {today.more} more waiting
        </a>
      ) : null}
    </section>
  );
}
