"use client";

/**
 * One approval card (Cards.dc.html): head = department · kind, body = the thing itself, foot = price, account, time,
 * then exactly one filled button that does what the head names. Renders the `ApprovalCard` contract
 * (`lib/screens/approval-card.ts`) in the Dashboard queue (collapsible) and on `/app/inbox/[id]`.
 */

import Link from "next/link";
import { useState } from "react";

import { useShellState } from "@/components/shell-v2/ShellState";
import { Button, ButtonLink } from "@/components/ui";
import { PRIMARY_ACTION, type ApprovalCard as Card } from "@/lib/screens/approval-card";

import {
  CorrectionBody,
  FinishedVideoBody,
  GoalBody,
  PostBody,
  PriceBody,
  ReplyBody,
  ScheduleBody,
  ScriptBody,
  ShortsBody,
  SlideshowBody,
} from "./bodies";
import { blockedReason, type Decision } from "./decide";
import { NUMERAL, cardHead, headNote } from "./labels";

export type DecideHandler = (card: Card, decision: Decision) => Promise<boolean>;

type Variant = "primary" | "secondary" | "quiet";
type Action = { label: string; variant: Variant; run: () => void; disabled?: string } | { label: string; variant: Variant; href: string };

const PROBLEM_LABEL = { expired: "Expired", decided_elsewhere: "Decided", needs_credits: "Credits", failed: "Failed" } as const;

/** The decline action of each kind: its label and the decision it sends with the optional reason. */
const DECLINE: Partial<Record<Card["kind"], { label: string; action: "skip" | "dismissed" | "reject" }>> = {
  post: { label: "Skip with reason", action: "skip" },
  reply: { label: "Dismiss", action: "dismissed" },
  goal: { label: "Reject", action: "reject" },
  price: { label: "Cancel", action: "skip" },
  shorts_batch: { label: "Send back", action: "skip" },
  correction: { label: "Reject", action: "reject" },
};

/** A secondary action that belongs to a later phase: shown, disabled, with the reason. */
const LATER = "Opens with this department's release.";

function firstText(card: Card): string {
  if (card.body.kind === "post") return card.body.platforms[0]?.versions[0] ?? "";
  if (card.body.kind === "correction") return card.body.rule;
  if (card.body.kind === "slideshow") return card.body.slides[0] ?? "";
  return "";
}

function decidedNote(card: Card): string | null {
  if (card.status === "waiting" || card.problem) return null;
  return card.status === "skipped" || card.status === "cancelled" ? "You set this card aside." : "You decided this card.";
}

export function ApprovalCard({
  card,
  sample,
  onDecide,
  open = true,
  onToggle,
  headingLevel = "h3",
}: {
  card: Card;
  /** Fixture card (outside production only): decisions change this screen and nothing else. */
  sample: boolean;
  onDecide: DecideHandler;
  /** Queue only: whether the body shows. */
  open?: boolean;
  /** Queue only: makes the head a toggle. */
  onToggle?: () => void;
  headingLevel?: "h2" | "h3";
}) {
  const { toast } = useShellState();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(() => firstText(card));
  const [draft, setDraft] = useState(() => firstText(card));

  const blocked = blockedReason(card, sample);
  const Heading = headingLevel;
  const head = cardHead(card);
  const numeral = NUMERAL[card.department];
  const note = headNote(card);
  const bodyId = `card-${card.id}-body`;
  const decline = DECLINE[card.kind];

  async function run(decision: Decision) {
    if (busy || blocked) return;
    setBusy(true);
    const ok = await onDecide(card, decision);
    // A decided card leaves the queue and unmounts; only a refused one comes back to edit.
    if (!ok) setBusy(false);
  }

  function approve() {
    if (card.kind === "post") {
      const text = editing ? draft.trim() : shown;
      // The first version is what the card's hash covers as is; any other text is sent as the founder's edit.
      return run({ action: "approve", text: text !== firstText(card) ? text : undefined });
    }
    if (card.kind === "correction" && editing) return run({ action: "edit", text: draft.trim() });
    return run({ action: "approve" });
  }

  async function copyReply() {
    if (card.body.kind !== "reply") return;
    try {
      await navigator.clipboard.writeText(card.body.draft);
      toast("Reply copied. Paste it in the thread and post it from your own account.");
    } catch {
      toast("Copy did not work here. Select the reply and copy it yourself.");
    }
    window.open(card.body.threadUrl, "_blank", "noopener,noreferrer");
  }

  const editAction = (label = "Edit"): Action => ({
    label: editing ? "Stop editing" : label,
    variant: "secondary",
    run: () => {
      if (!editing) setDraft(card.kind === "post" ? shown : card.body.kind === "correction" ? card.body.rule : draft);
      setEditing((was) => !was);
    },
  });
  const declineAction: Action[] = decline ? [{ label: decline.label, variant: "quiet", run: () => setDeclining(true) }] : [];
  const primary = (label = PRIMARY_ACTION[card.kind]): Action => ({ label, variant: "primary", run: approve });
  const later = (label: string): Action => ({ label, variant: "secondary", run: () => undefined, disabled: LATER });

  const actions: Action[] = (() => {
    switch (card.body.kind) {
      case "post":
        return [primary(editing ? "Approve edit" : "Approve"), editAction(), ...declineAction];
      case "reply":
        return [
          { label: PRIMARY_ACTION.reply, variant: "primary", run: copyReply },
          { label: "I replied", variant: "secondary", run: () => run({ action: "replied" }) },
          ...declineAction,
        ];
      case "goal":
        return [primary(), { label: "Edit plan", variant: "secondary", href: "/app/brain" }, ...declineAction];
      case "script":
        return [primary(), later("Edit a beat")];
      case "price":
        return [primary(), later("Redo a keyframe"), ...declineAction];
      case "finished_video":
        return [primary(), { label: "Open in editor", variant: "secondary", href: `/app/editor/${encodeURIComponent(card.body.clipId)}` }];
      case "shorts_batch":
        return [primary(), ...declineAction];
      case "slideshow":
        return [primary(), later("Open in Slides")];
      case "schedule":
        return [primary(), later("Change time")];
      case "correction":
        return [primary(editing ? "Keep edited rule" : PRIMARY_ACTION.correction), editAction(), ...declineAction];
    }
  })();

  // The price card shows its price large in the body; `meta` already names the account and time.
  const foot = [card.priceCredits !== null && card.kind !== "price" ? `${card.priceCredits} credits` : null, card.meta || null].filter(Boolean).join(" · ");
  const decided = decidedNote(card);

  const headRow = (
    <span className="v2-card-head">
      <span>
        {numeral ? <span className="v2-card-numeral">{numeral} </span> : null}
        {head}
      </span>
      {note ? <span>{note}</span> : null}
    </span>
  );

  return (
    <article className="v2-card" data-open={open || undefined} data-status={card.status} data-testid="approval-card" data-card-id={card.id} aria-label={`${head}: ${card.title}`}>
      {onToggle ? (
        <Heading className="v2-card-heading">
          <button type="button" className="v2-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
            {headRow}
            <span className="v2-card-title">{card.title}</span>
          </button>
        </Heading>
      ) : (
        <Heading className="v2-card-heading is-static">
          {headRow}
          <span className="v2-visually-hidden">{card.title}</span>
        </Heading>
      )}

      {open ? (
        <div id={bodyId} className="v2-card-body">
          {card.body.kind === "post" ? (
            <PostBody body={card.body} cardId={card.id} editing={editing} draft={draft} onDraft={setDraft} onPick={setShown} />
          ) : card.body.kind === "reply" ? (
            <ReplyBody body={card.body} />
          ) : card.body.kind === "goal" ? (
            <GoalBody body={card.body} />
          ) : card.body.kind === "script" ? (
            <ScriptBody body={card.body} />
          ) : card.body.kind === "price" ? (
            <PriceBody body={card.body} price={card.priceCredits} />
          ) : card.body.kind === "finished_video" ? (
            <FinishedVideoBody body={card.body} />
          ) : card.body.kind === "shorts_batch" ? (
            <ShortsBody body={card.body} />
          ) : card.body.kind === "slideshow" ? (
            <SlideshowBody body={card.body} cardId={card.id} firstSlide={shown} onFirstSlide={setShown} />
          ) : card.body.kind === "schedule" ? (
            <ScheduleBody body={card.body} />
          ) : (
            <CorrectionBody body={card.body} editing={editing} draft={draft} onDraft={setDraft} />
          )}

          {foot ? <div className="v2-card-meta">{foot}</div> : null}

          {card.problem ? (
            <p className={`v2-card-state is-${card.problem.kind}`}>
              <b>{PROBLEM_LABEL[card.problem.kind]}</b>
              <span>{card.problem.text}</span>
              {card.problem.kind === "needs_credits" ? <Link href="/app/billing">Top up</Link> : null}
            </p>
          ) : decided ? (
            <p className="v2-card-state is-decided_elsewhere">
              <b>Decided</b>
              <span>{decided}</span>
            </p>
          ) : null}

          {declining && decline ? (
            <form
              className="v2-card-decline"
              onSubmit={(event) => {
                event.preventDefault();
                void run({ action: decline.action, reason: reason.trim() || undefined });
              }}
            >
              <label className="v2-field">
                <span>Why? Your CMO learns from it (optional)</span>
                <input className="v2-input" value={reason} maxLength={400} autoFocus onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="v2-actions">
                <Button type="submit" variant="primary" compact disabled={busy}>
                  {decline.label}
                </Button>
                <Button variant="quiet" compact onClick={() => setDeclining(false)}>
                  Keep it
                </Button>
              </div>
            </form>
          ) : card.status !== "waiting" || card.problem?.kind === "decided_elsewhere" ? null : (
            <div className="v2-actions">
              {actions.map((action) =>
                "href" in action ? (
                  <ButtonLink key={action.label} variant={action.variant} compact href={action.href}>
                    {action.label}
                  </ButtonLink>
                ) : (
                  <Button
                    key={action.label}
                    variant={action.variant}
                    compact
                    disabled={busy || !!action.disabled || (!!blocked && action.label !== "Stop editing")}
                    title={action.disabled ?? blocked ?? undefined}
                    onClick={action.run}
                  >
                    {action.label}
                  </Button>
                ),
              )}
            </div>
          )}
          {blocked && card.status === "waiting" && !card.problem ? <p className="v2-card-meta">{blocked}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
