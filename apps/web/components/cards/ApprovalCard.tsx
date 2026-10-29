"use client";

/**
 * One approval card (Cards.dc.html): head = department · kind, body = the thing itself, foot = price, account, time,
 * then exactly one filled button that does what the head names. Renders the `ApprovalCard` contract
 * (`lib/screens/approval-card.ts`) in the Dashboard queue (collapsible) and on `/app/inbox/[id]`.
 */

import Link from "next/link";
import { useState } from "react";

import { useShellState } from "@/components/shell-v2/ShellState";
import { ApiError } from "@/components/clipping/api";
import { Button, ButtonLink } from "@/components/ui";
import { PRIMARY_ACTION, type ApprovalCard as Card, type Caption } from "@/lib/screens/approval-card";

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
import { POST_TARGET, blockedReason, editCaption, postPlatform, type Decision } from "./decide";
import { NUMERAL, cardHead, headNote } from "./labels";

export type DecideHandler = (card: Card, decision: Decision) => Promise<boolean>;

type Variant = "primary" | "secondary" | "quiet";
type Action =
  | { label: string; variant: Variant; run: () => void; disabled?: string; /** Set on declines: checked on its own. */ declines?: boolean }
  | { label: string; variant: Variant; href: string };

const PROBLEM_LABEL = { expired: "Expired", decided_elsewhere: "Decided", needs_credits: "Credits", failed: "Failed" } as const;

/** The decline action of each kind: its label and the decision it sends with the optional reason. */
const DECLINE: Partial<Record<Card["kind"], { label: string; action: "skip" | "dismissed" | "reject" | "cancel" | "send_back" }>> = {
  post: { label: "Skip with reason", action: "skip" },
  reply: { label: "Dismiss", action: "dismissed" },
  goal: { label: "Reject", action: "reject" },
  script: { label: "Cancel", action: "cancel" },
  price: { label: "Cancel", action: "cancel" },
  finished_video: { label: "Send back", action: "send_back" },
  shorts_batch: { label: "Send back", action: "send_back" },
  correction: { label: "Dismiss", action: "reject" },
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
  card: given,
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
  // A saved caption changes the card in place (new hash); a newer card from the parent replaces it.
  const [changed, setChanged] = useState<{ from: Card; card: Card } | null>(null);
  const card = changed && changed.from === given ? changed.card : given;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  /** Price card: the keyframe picker is open. */
  const [redoing, setRedoing] = useState(false);
  const [keyframe, setKeyframe] = useState(0);
  /** Script card: the beat being edited. */
  const [beat, setBeat] = useState(0);
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState(() => firstText(card));
  const [draft, setDraft] = useState(() => firstText(card));
  const beats = card.body.kind === "script" ? card.body.beats : [];

  const blocked = blockedReason(card, sample);
  const captionsBlocked = blocked ?? (busy ? "Wait for the decision to finish." : null);
  const Heading = headingLevel;
  const head = cardHead(card);
  const numeral = NUMERAL[card.department];
  const note = headNote(card);
  const bodyId = `card-${card.id}-body`;
  const decline = DECLINE[card.kind];

  async function run(decision: Decision): Promise<boolean> {
    if (busy || blockedReason(card, sample, decision.action)) return false;
    setBusy(true);
    const ok = await onDecide(card, decision);
    // A decided card leaves the queue and unmounts; only a refused one comes back to edit.
    if (!ok) setBusy(false);
    return ok;
  }

  /**
   * Threads and LinkedIn are posted by the founder until Schedule posts them (P4): approve, then open the platform's
   * composer. The tab opens inside the click (a later one is blocked as a pop-up) and goes to the platform only once
   * the approval went through; LinkedIn's text is copied inside the click for the same reason.
   */
  async function approvePost(text: string) {
    const platform = postPlatform(card);
    const target = platform ? POST_TARGET[platform] : undefined;
    if (!target || blockedReason(card, sample, "approve") || busy) return run({ action: "approve", text: text !== firstText(card) ? text : undefined });
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const copied = !target.copy ? Promise.resolve(true) : navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
    // The first version is what the card's hash covers as is; any other text is sent as the founder's edit.
    const ok = await run({ action: "approve", text: text !== firstText(card) ? text : undefined });
    if (!ok) {
      tab?.close();
      return;
    }
    if (tab) tab.location.href = target.url(text);
    else toast("Your browser blocked the new tab. Open the platform yourself and post it from your account.");
    if (!(await copied)) toast("Copy did not work here. Select the post and copy it yourself.");
  }

  async function saveCaption(caption: Caption): Promise<boolean> {
    try {
      const next = await editCaption(card, caption, sample);
      setChanged({ from: given, card: next });
      toast(sample ? "Caption saved (sample, nothing was sent)." : "Caption saved. Approve the card when the words are right.");
      return true;
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      return false;
    }
  }

  function approve() {
    if (card.kind === "post") return void approvePost(editing ? draft.trim() : shown);
    if (card.kind === "correction" && editing) return run({ action: "edit", text: draft.trim() });
    if (card.kind === "script" && editing) {
      const words = draft.trim();
      // An unchanged beat approves the script as the card's hash covers it.
      return run(words && words !== beats[beat]?.words ? { action: "edit", beat, text: words } : { action: "approve" });
    }
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
      if (!editing) setDraft(card.kind === "post" ? shown : card.body.kind === "correction" ? card.body.rule : card.body.kind === "script" ? (beats[beat]?.words ?? "") : draft);
      setEditing((was) => !was);
    },
  });
  const declineAction: Action[] = decline ? [{ label: decline.label, variant: "quiet", run: () => setDeclining(true), declines: true }] : [];
  const declineBlocked = decline ? blockedReason(card, sample, decline.action) : blocked;
  const primary = (label = PRIMARY_ACTION[card.kind]): Action => ({ label, variant: "primary", run: approve });
  const later = (label: string): Action => ({ label, variant: "secondary", run: () => undefined, disabled: LATER });

  const actions: Action[] = (() => {
    switch (card.body.kind) {
      case "post": {
        const platform = postPlatform(card);
        const opens = platform ? (POST_TARGET[platform]?.label ?? "") : "";
        return [primary(`${editing ? "Approve edit" : "Approve"}${opens}`), editAction(), ...declineAction];
      }
      case "reply":
        return [
          { label: PRIMARY_ACTION.reply, variant: "primary", run: copyReply },
          { label: "I replied", variant: "secondary", run: () => run({ action: "replied" }) },
          ...declineAction,
        ];
      case "goal":
        return [primary(), { label: "Edit plan", variant: "secondary", href: "/app/brain" }, ...declineAction];
      case "script":
        return [primary(editing ? "Approve edit" : PRIMARY_ACTION.script), editAction("Edit a beat"), ...declineAction];
      case "price":
        // Redo exists only for a contact sheet: a price for shots alone has no keyframe to make again.
        return [primary(), ...(card.body.keyframes.length > 0 ? [{ label: "Redo a keyframe", variant: "secondary" as const, run: () => setRedoing(true) }] : []), ...declineAction];
      case "finished_video":
        return [primary(), { label: "Open in editor", variant: "secondary", href: `/app/editor/${encodeURIComponent(card.body.clipId)}` }, ...declineAction];
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
            <ScriptBody
              body={card.body}
              cardId={card.id}
              editing={editing}
              beat={beat}
              draft={draft}
              onDraft={setDraft}
              onBeat={(index) => {
                setBeat(index);
                setDraft(beats[index]?.words ?? "");
              }}
            />
          ) : card.body.kind === "price" ? (
            <PriceBody body={card.body} price={card.priceCredits} />
          ) : card.body.kind === "finished_video" ? (
            <FinishedVideoBody body={card.body} cardId={card.id} editable={captionsBlocked} onSaveCaption={saveCaption} />
          ) : card.body.kind === "shorts_batch" ? (
            <ShortsBody body={card.body} cardId={card.id} editable={captionsBlocked} onSaveCaption={saveCaption} />
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

          {redoing && card.body.kind === "price" ? (
            <form
              className="v2-card-decline"
              onSubmit={(event) => {
                event.preventDefault();
                void run({ action: "redo", index: keyframe });
              }}
            >
              <fieldset className="v2-field">
                <legend>Which keyframe should be made again? Only that one is redone; its price comes on a new card.</legend>
                <div className="v2-card-keyframes">
                  {card.body.keyframes.map((frame) => (
                    <label key={frame.index} className="v2-card-keyframe" title={frame.label}>
                      <input type="radio" name={`${card.id}-keyframe`} value={frame.index} checked={keyframe === frame.index} onChange={() => setKeyframe(frame.index)} />
                      <span>
                        <span className="v2-visually-hidden">Keyframe </span>
                        {String(frame.index + 1).padStart(2, "0")}
                        {frame.garbled ? <span className="v2-visually-hidden"> (text may be garbled)</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="v2-actions">
                <Button type="submit" variant="primary" compact disabled={busy}>
                  Redo keyframe {keyframe + 1}
                </Button>
                <Button variant="quiet" compact onClick={() => setRedoing(false)}>
                  Keep it
                </Button>
              </div>
            </form>
          ) : declining && decline ? (
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
                    disabled={busy || !!action.disabled || (!!(action.declines ? declineBlocked : blocked) && action.label !== "Stop editing")}
                    title={action.disabled ?? (action.declines ? declineBlocked : blocked) ?? undefined}
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
