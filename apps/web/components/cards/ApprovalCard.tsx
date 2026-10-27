"use client";

/**
 * One approval card (Cards.dc.html): head = department · kind, body = the thing itself, foot = price, account, time,
 * then exactly one filled button that does what the head names. The same component renders in the Dashboard queue
 * (collapsible), on `/app/inbox/[id]` and on the design sheet.
 */

import Link from "next/link";
import { useState } from "react";

import { useShellState } from "@/components/shell-v2/ShellState";
import { Button, ButtonLink } from "@/components/ui";

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
import { NUMERAL, cardHead, type ApprovalCardView } from "./model";

export type DecideHandler = (card: ApprovalCardView, decision: Decision) => Promise<boolean>;

type Action =
  | { label: string; variant: "primary" | "secondary" | "quiet"; run: () => void; disabled?: string }
  | { label: string; variant: "primary" | "secondary" | "quiet"; href: string; external?: boolean };

const STATE_LABEL = { expired: "Expired", decided: "Decided", needs_credits: "Credits", failed: "Failed" } as const;

/** Labels of the decline action that asks for a reason, per kind. */
const DECLINE: Partial<Record<ApprovalCardView["kind"], string>> = {
  post: "Skip with reason",
  reply: "Dismiss",
  price: "Cancel",
  shorts_batch: "Send back",
  correction: "Reject",
};

/** A secondary action that belongs to a later phase: shown, disabled, with the reason. */
const LATER = "Opens with this department's release.";

function firstText(card: ApprovalCardView): string {
  if (card.body.kind === "post") return card.body.versions[0]?.texts[0] ?? "";
  if (card.body.kind === "correction") return card.body.rule;
  if (card.body.kind === "slideshow") return card.body.slides[0] ?? "";
  return "";
}

export function ApprovalCard({
  card,
  onDecide,
  open = true,
  onToggle,
  headingLevel = "h3",
}: {
  card: ApprovalCardView;
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

  const blocked = blockedReason(card);
  const Heading = headingLevel;
  const head = cardHead(card);
  const numeral = NUMERAL[card.department];
  const bodyId = `card-${card.id}-body`;

  async function run(decision: Decision) {
    if (busy || blocked) return;
    setBusy(true);
    const ok = await onDecide(card, decision);
    // A decided card leaves the queue and unmounts; only a refused one comes back to edit.
    if (!ok) setBusy(false);
  }

  function approve() {
    if (card.kind === "post") return run({ action: "approve", text: editing ? draft.trim() : shown !== firstText(card) ? shown : undefined });
    if (card.kind === "correction") return run({ action: "approve", text: editing ? draft.trim() : undefined });
    if (card.kind === "slideshow") return run({ action: "approve", text: shown });
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

  const decline = DECLINE[card.kind];
  const declineAction: Action | null = decline ? { label: decline, variant: "quiet", run: () => setDeclining(true) } : null;
  const editAction = (label = "Edit"): Action => ({
    label: editing ? "Stop editing" : label,
    variant: "secondary",
    run: () => {
      setDraft(card.kind === "post" ? shown : draft);
      setEditing((was) => !was);
    },
  });

  const actions: Action[] = (() => {
    switch (card.kind) {
      case "post":
        return [{ label: editing ? "Approve edit" : "Approve", variant: "primary", run: approve }, editAction(), declineAction!];
      case "reply":
        return [
          { label: "Copy and open thread", variant: "primary", run: copyReply },
          { label: "I replied", variant: "secondary", run: () => run({ action: "replied" }) },
          declineAction!,
        ];
      case "goal":
        return [
          { label: "Approve week", variant: "primary", run: approve },
          { label: "Edit plan", variant: "secondary", href: "/app/brain" },
        ];
      case "script":
        return [
          { label: "Approve script", variant: "primary", run: approve },
          { label: "Edit a beat", variant: "secondary", run: () => undefined, disabled: LATER },
        ];
      case "price":
        return [
          { label: "Approve price", variant: "primary", run: approve },
          { label: "Redo a keyframe", variant: "secondary", run: () => undefined, disabled: LATER },
          declineAction!,
        ];
      case "finished_video":
        return [
          { label: "Approve: finished", variant: "primary", run: approve },
          card.body.kind === "finished_video" && card.body.editorHref
            ? { label: "Open in editor", variant: "secondary", href: card.body.editorHref }
            : { label: "Open in editor", variant: "secondary", run: () => undefined, disabled: "This video has no edit to open." },
        ];
      case "shorts_batch":
        return [{ label: "Approve batch", variant: "primary", run: approve }, declineAction!];
      case "slideshow":
        return [
          { label: "Approve", variant: "primary", run: approve },
          { label: "Open in Slides", variant: "secondary", run: () => undefined, disabled: LATER },
        ];
      case "schedule":
        return [
          { label: "Approve time", variant: "primary", run: approve },
          { label: "Change time", variant: "secondary", run: () => undefined, disabled: LATER },
        ];
      case "correction":
        return [{ label: editing ? "Keep edited rule" : "Keep as a rule", variant: "primary", run: approve }, editAction(), declineAction!];
    }
  })();

  // The price card shows its price large in the body; the foot does not repeat it.
  const foot = [card.price !== null && card.kind !== "price" ? `${card.price} credits` : null, card.account, card.when, card.note].filter(Boolean).join(" · ");
  const decidable = !blocked;

  const headRow = (
    <span className="v2-card-head">
      <span>
        {numeral ? <span className="v2-card-numeral">{numeral} </span> : null}
        {head}
      </span>
      {card.headNote ? <span>{card.headNote}</span> : null}
    </span>
  );

  return (
    <article className="v2-card" data-open={open || undefined} data-state={card.state} data-testid="approval-card" data-card-id={card.id} aria-label={`${head}: ${card.title}`}>
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
            <PriceBody body={card.body} price={card.price} />
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

          {card.state !== "waiting" ? (
            <p className={`v2-card-state is-${card.state}`}>
              <b>{STATE_LABEL[card.state]}</b>
              <span>{card.stateNote}</span>
              {card.state === "needs_credits" ? <Link href="/app/billing">Top up</Link> : null}
            </p>
          ) : null}

          {declining ? (
            <form
              className="v2-card-decline"
              onSubmit={(event) => {
                event.preventDefault();
                void run({ action: "skip", reason: reason.trim() || undefined });
              }}
            >
              <label className="v2-field">
                <span>Why? Your CMO learns from it (optional)</span>
                <input className="v2-input" value={reason} maxLength={400} autoFocus onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="v2-actions">
                <Button type="submit" variant="primary" compact disabled={busy}>
                  {decline}
                </Button>
                <Button variant="quiet" compact onClick={() => setDeclining(false)}>
                  Keep it
                </Button>
              </div>
            </form>
          ) : card.state === "decided" ? null : (
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
                    disabled={busy || !!action.disabled || (!decidable && action.label !== "Stop editing")}
                    title={action.disabled ?? blocked ?? undefined}
                    onClick={action.run}
                  >
                    {action.label}
                  </Button>
                ),
              )}
            </div>
          )}
          {blocked && card.state === "waiting" ? <p className="v2-card-meta">{blocked}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
