"use client";

/**
 * One approval card (Cards.dc.html): head = department · kind, body = the thing itself, foot = price, account, time,
 * then exactly one filled button that does what the head names. Renders the `ApprovalCard` contract
 * (`lib/screens/approval-card.ts`) in the Dashboard queue (collapsible) and on `/app/inbox/[id]`.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { useShellState } from "@/components/shell-v2/ShellState";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { Button, ButtonLink } from "@/components/ui";
import { intentFor } from "@/lib/departments/publish/intent";
import { chainFor } from "@/lib/departments/publish/split";
import { isPublishPlatform } from "@/lib/departments/publish/types";
import { PRIMARY_ACTION, type ApprovalCard as Card, type Caption, type ScheduleOptions } from "@/lib/screens/approval-card";
import { PLATFORM_LABEL } from "@/lib/screens/common";

import {
  CorrectionBody,
  FinishedVideoBody,
  GoalBody,
  PlanBody,
  PostBody,
  PriceBody,
  ReplyBody,
  ScheduleBody,
  ScriptBody,
  ShortsBody,
  SlideshowBody,
} from "./bodies";
import { useConnectedPlatforms } from "./connected";
import { openScript } from "./open-script";
import { blockedReason, editCaption, type Decision } from "./decide";
import { renderAgain, saveSlideText, slidesHref } from "./slides";
import { NUMERAL, autoLabel, cardHead, headNote, type DraftReason } from "./labels";
import { ReasonChips } from "./ReasonChips";
import { approveBlocked, formatWhen, fromLocalInput, sameOptions, savedOptions, toLocalInput } from "./schedule";
import { PhotoStrip, PostPhotos } from "./post-photos";

export type DecideHandler = (card: Card, decision: Decision) => Promise<boolean>;

type Variant = "primary" | "secondary" | "quiet";
type Action =
  | {
      label: string;
      variant: Variant;
      run: () => void;
      disabled?: string;
      /** Set on declines: checked on its own. */
      declines?: boolean;
      /** The decision this button sends, when a card's problem allows some actions and not others. */
      checks?: Decision["action"];
    }
  | { label: string; variant: Variant; href: string };

const STATE_LABEL = { failed: "Failed", missed: "Missed", no_account: "Copy and open", unconfirmed: "Not confirmed" } as const;

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
  slideshow: { label: "Send back", action: "send_back" },
  correction: { label: "Dismiss", action: "reject" },
  schedule: { label: "Cancel", action: "cancel" },
  plan: { label: "Skip", action: "skip" },
};

/** What an edited approve can say it fixed: the chips that are edit labels (cmo-review-3 2.1). */
const FIX_REASONS: readonly DraftReason[] = ["TOO_SALESY", "WRONG_VOICE", "INVENTED_CLAIM", "TOO_LONG", "HOOK_REWRITTEN"];

function firstText(card: Card): string {
  if (card.body.kind === "post") return card.body.platforms[0]?.versions[0] ?? "";
  if (card.body.kind === "correction") return card.body.rule;
  return "";
}

/**
 * The time a post card approves with its words (cmo-review-3 1.2): "Goes out Tue 11 Nov, 09:00 on X (@handle)", or,
 * with no account, "Opens X to post at …". A time already past says that approving asks for a new one.
 */
export function postWhen(proposed: NonNullable<Extract<Card["body"], { kind: "post" }>["proposed"]>, now = Date.now()): string {
  const when = formatWhen(proposed.at, proposed.timezone);
  const where = PLATFORM_LABEL[proposed.platform];
  if (new Date(proposed.at).getTime() <= now) return `Its time (${when}) has passed. Approve it and pick a new time, or change it here.`;
  return proposed.mode === "publish"
    ? `Goes out ${when} on ${where}${proposed.handle ? ` (${proposed.handle})` : ""}, your time.`
    : `Opens ${where} to post at ${when}, your time. You post it from your account.`;
}

function decidedNote(card: Card): string | null {
  if (card.status === "waiting" || card.problem) return null;
  return card.status === "skipped" || card.status === "cancelled" ? "You set this card aside." : "You decided this card.";
}

/** How long a rewrite may take before its button is offered again (the run itself is one model call). */
const REWRITE_WAIT_MS = 120_000;

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
  /** Script card: the beat being edited. */
  const [beat, setBeat] = useState(0);
  const [reason, setReason] = useState("");
  /** Post card (cmo-review-3 2.1): the chip picked on Skip, and the one picked as "What did you fix?" on an edit. */
  const [reasonCode, setReasonCode] = useState<DraftReason | null>(null);
  const [fixCode, setFixCode] = useState<DraftReason | null>(null);
  /** Schedule card: the platform's fields as the founder is changing them, and the change-time picker. */
  const [options, setOptions] = useState<ScheduleOptions>(() => (card.body.kind === "schedule" ? card.body.options : {}));
  const [moving, setMoving] = useState(false);
  const [newTime, setNewTime] = useState("");
  const [shown, setShown] = useState(() => firstText(card));
  /** Slideshow card: a slide's words were saved, so its renders are older than the edit and a new render runs. */
  const [slideEdited, setSlideEdited] = useState(false);
  /** Slideshow card: a decision was refused (the slideshow was edited elsewhere since it was rendered). */
  const [slideStale, setSlideStale] = useState(false);
  const [draft, setDraft] = useState(() => firstText(card));
  /** Week plan card: the items the founder unticked. */
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set());
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
    // A slideshow refused after an edit in the Slides view can be rendered again from here.
    if (!ok && card.kind === "slideshow") setSlideStale(true);
    return ok;
  }

  // A post draft whose platform has no connected account offers copy and open and "I posted it" right away (S2.6).
  const connected = useConnectedPlatforms(sample || card.body.kind !== "post");
  const postPlatform = card.body.kind === "post" ? card.body.platforms[0]?.platform : undefined;
  const postYourself =
    card.body.kind === "post" && connected !== null && postPlatform !== undefined && !connected.has(postPlatform) && !card.body.platforms.some((p) => p.thread);
  const postText = () => (editing ? draft.trim() : shown);

  // "Rewrite for <platform>" (D4): the price is on the button and held before the model runs (`repurpose_post`).
  const [rewriting, setRewriting] = useState<ReadonlySet<string>>(new Set());
  const postItem = card.body.kind === "post" ? card.body.itemId : undefined;
  const canRewrite = card.body.kind === "post" && card.status === "waiting" && !!postItem && !card.body.platforms.some((p) => p.thread);
  const doneRewriting = (platform: string) =>
    setRewriting((now) => {
      const next = new Set(now);
      next.delete(platform);
      return next;
    });
  // The rewrite lands as a newer version of this card: the button is free again, to rewrite once more.
  useEffect(() => setRewriting(new Set()), [given]);
  async function rewrite(platform: string) {
    if (sample) return toast("Sample card: nothing was rewritten or charged.");
    if (!postItem || rewriting.has(platform)) return;
    setRewriting((now) => new Set(now).add(platform));
    try {
      await api(`/cmo/items/${encodeURIComponent(postItem)}/repurpose`, jsonBody({ platform }));
      toast(`Rewriting it for ${PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform}. It shows on this card in about a minute.`);
      // A rewrite that fails its checks changes nothing here (its credit comes back): the button must not stay stuck.
      window.setTimeout(() => doneRewriting(platform), REWRITE_WAIT_MS);
    } catch (error) {
      doneRewriting(platform);
      toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
  }

  async function copyAndOpenText(platform: string, text: string) {
    const target = isPublishPlatform(platform) ? intentFor(platform, text) : null;
    if (!target) return;
    const copied = target.copy ? (navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false)) : Promise.resolve(true);
    const tab = window.open(target.url, "_blank", "noopener,noreferrer");
    if (!(await copied)) toast("Copy did not work here. Select the post and copy it yourself.");
    else toast(tab === null && !target.copy ? "Your browser blocked the new tab. Open the platform yourself and post it from your account." : "Post it from your account, then tell us here.");
  }

  /**
   * The copy-and-open moment of a post with no connected account (P4 F9): X and Threads open their composer with the
   * words in it, LinkedIn's text is copied first. The tab opens and the text is copied inside the click (later ones
   * are blocked); the founder then says "I posted it". A sample card opens nothing and copies nothing.
   */
  async function copyAndOpen(body: Extract<Card["body"], { kind: "schedule" }>) {
    if (sample) return toast("Sample card: nothing was copied or opened.");
    // A chain opens with its first part in the composer; the card's Copy buttons give the rest.
    const text = body.preview.text ?? "";
    return copyAndOpenText(body.where.platform, chainFor(body.where.platform, text)?.[0] ?? text);
  }

  async function copyPart(post: string, index: number) {
    if (sample) return toast("Sample card: nothing was copied.");
    const ok = navigator.clipboard ? await navigator.clipboard.writeText(post).then(() => true, () => false) : false;
    toast(ok ? `Post ${index + 1} copied.` : "Copy did not work here. Select the post and copy it yourself.");
  }

  async function saveSlide(index: number, heading: string, words: string): Promise<boolean> {
    try {
      const next = await saveSlideText(card, index, heading, words, sample);
      setChanged({ from: given, card: next });
      setSlideEdited(true);
      toast(sample ? "Slide saved (sample, nothing was sent)." : "Slide saved. The slideshow renders again and comes back as a new card.");
      return true;
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      return false;
    }
  }

  /** A script the founder records: approved (or edited), then its blank edit opens with a marker on each beat. */
  async function approveAndOpen() {
    if (card.body.kind !== "script") return;
    const words = draft.trim();
    const decision: Decision = editing && words && words !== beats[beat]?.words ? { action: "edit", beat, text: words } : { action: "approve" };
    const orderId = card.body.stepId;
    if (!(await run(decision)) || sample) return;
    try {
      await openScript(orderId);
    } catch (error) {
      toast(error instanceof ApiError ? `Script approved. ${error.message}` : "Script approved, but the editor did not open. Try again from the Writer screen.");
    }
  }

  async function rerender() {
    if (busy) return;
    setBusy(true);
    try {
      await renderAgain(card, sample);
      setSlideEdited(true);
      setSlideStale(false);
      toast(sample ? "Rendering again (sample, nothing was sent)." : "Rendering again. A new card replaces this one when it is ready.");
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
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
    // The first version is what the card's hash covers as is; any other text is sent as the founder's edit.
    if (card.kind === "post") {
      const text = editing ? draft.trim() : shown;
      // The chip goes only with words the founder changed; picking another version as written is not an edit.
      const fixed = editing && text !== shown && fixCode && FIX_REASONS.includes(fixCode) ? fixCode : undefined;
      return run({ action: "approve", text: text !== firstText(card) ? text : undefined, ...(fixed ? { reasonCode: fixed } : {}) });
    }
    if (card.kind === "correction" && editing) return run({ action: "edit", text: draft.trim() });
    if (card.kind === "script" && editing) {
      const words = draft.trim();
      // An unchanged beat approves the script as the card's hash covers it.
      return run(words && words !== beats[beat]?.words ? { action: "edit", beat, text: words } : { action: "approve" });
    }
    if (card.kind === "plan") return run({ action: "approve", ...(dropped.size ? { drop: [...dropped] } : {}) });
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
  const blockedFor = (action: Extract<Action, { run: () => void }>) =>
    action.declines ? declineBlocked : action.checks ? blockedReason(card, sample, action.checks) : blocked;
  const primary = (label = PRIMARY_ACTION[card.kind]): Action => ({ label, variant: "primary", run: approve });
  const proposed = card.body.kind === "post" ? card.body.proposed : undefined;
  const postChangeTime: Action | null = proposed
    ? {
        label: "Change time",
        variant: "secondary",
        checks: "change_time",
        run: () => {
          setNewTime(toLocalInput(proposed.at, proposed.timezone));
          setMoving(true);
        },
      }
    : null;

  const actions: Action[] = (() => {
    switch (card.body.kind) {
      case "post":
        // A thread (P6 W4) is approved as written: one edited post would no longer match the thread it opens.
        if (card.body.platforms.some((p) => p.thread)) return [primary("Approve thread"), ...(postChangeTime ? [postChangeTime] : []), ...declineAction];
        if (postYourself && postPlatform && isPublishPlatform(postPlatform)) {
          const target = intentFor(postPlatform, postText());
          // Approve leads (owner, 2026-11-11: it was a quiet link after four buttons, and nobody found it). Posting it
          // right now by hand stays one click away, as the second and third buttons.
          return [
            { label: proposed ? "Approve for this time" : "Approve and schedule", variant: "primary", run: approve },
            // X and Threads open their composer with the words in it; LinkedIn's label already says it copies.
            ...(target ? [{ label: target.label, variant: "secondary" as const, run: () => void copyAndOpenText(postPlatform, postText()) }] : []),
            {
              label: "I posted it",
              variant: "secondary" as const,
              run: () => {
                const text = postText();
                void run({ action: "posted_self", text: text !== firstText(card) ? text : undefined });
              },
            },
            editAction(),
            ...(postChangeTime ? [postChangeTime] : []),
            ...declineAction,
          ];
        }
        return [primary(editing ? "Approve edit" : "Approve"), editAction(), ...(postChangeTime ? [postChangeTime] : []), ...declineAction];
      case "reply":
        return [
          { label: PRIMARY_ACTION.reply, variant: "primary", run: copyReply },
          { label: "I replied", variant: "secondary", run: () => run({ action: "replied" }) },
          ...declineAction,
        ];
      case "goal":
        return [primary(), { label: "Edit plan", variant: "secondary", href: "/app?doc=plan" }, ...declineAction];
      case "script":
        if (card.body.forFounder) return [{ label: editing ? "Approve edit and open" : "Approve and open in editor", variant: "primary", run: () => void approveAndOpen() }, editAction("Edit a beat"), ...declineAction];
        return [primary(editing ? "Approve edit" : PRIMARY_ACTION.script), editAction("Edit a beat"), ...declineAction];
      case "price":
        // No keyframe redo from a card: the contact sheet went with the two-card /video (2026-11-06); `redo_keyframe` does it
        // in the editor, and Studio fails a step decided "redo" (`studio-orders.ts`).
        return [primary(), ...declineAction];
      case "finished_video":
        return [primary(), { label: "Open in editor", variant: "secondary", href: `/app/editor/${encodeURIComponent(card.body.clipId)}` }, ...declineAction];
      case "shorts_batch":
        return [primary(), ...declineAction];
      case "slideshow":
        // Approving words the renders do not show yet would approve a video nobody saw: wait for the new card.
        if (slideStale && !slideEdited) return [{ label: "Render again", variant: "primary", run: () => void rerender() }, { label: "Open in Slides", variant: "secondary", href: slidesHref(card.body.clipId) }, ...declineAction];
        return [{ ...primary(), disabled: slideEdited ? "The slideshow renders again with your words; approve the new card." : undefined }, { label: "Open in Slides", variant: "secondary", href: slidesHref(card.body.clipId) }, ...declineAction];
      case "schedule": {
        const body = card.body;
        const changeTime: Action = {
          label: "Change time",
          variant: "secondary",
          checks: "change_time",
          run: () => {
            setNewTime(toLocalInput(body.at, body.timezone));
            setMoving(true);
          },
        };
        if (body.state === "no_account") {
          const target = isPublishPlatform(body.where.platform) ? intentFor(body.where.platform, body.preview.text ?? "") : null;
          return [
            ...(target ? [{ label: target.label, variant: "primary" as const, run: () => void copyAndOpen(body) }] : []),
            { label: "I posted it", variant: target ? ("secondary" as const) : ("primary" as const), checks: "posted", run: () => void run({ action: "posted" }) },
            ...declineAction,
          ];
        }
        // Zernio took it and never confirmed it: it may be live, so the founder checks. No Retry: it could post twice.
        if (body.state === "unconfirmed")
          return [{ label: "It went out", variant: "primary", checks: "posted", run: () => void run({ action: "posted" }) }, changeTime, ...declineAction];
        // A failed post keeps its card open with the reason while its window lasts (A1); Retry posts it now.
        // A free X account refused a long post: Retry would fail the same way, so the card offers the thread instead.
        if (body.state === "failed" && body.canThread && !body.options.as_thread)
          return [
            { label: "Post as a thread", variant: "primary", checks: "set_options", run: () => void run({ action: "set_options", options: { ...body.options, as_thread: true } }) },
            changeTime,
            ...declineAction,
          ];
        if (card.problem?.kind === "failed" || body.state === "failed") return [{ label: "Retry", variant: "primary", checks: "retry", run: () => void run({ action: "retry" }) }, changeTime, ...declineAction];
        if (!sameOptions(options, body.options))
          return [
            { label: "Save changes", variant: "primary", run: () => void run({ action: "set_options", options: savedOptions(body, options) }) },
            { label: "Undo changes", variant: "secondary", run: () => setOptions(body.options) },
          ];
        return [{ ...primary(), disabled: approveBlocked(body, options) ?? undefined }, changeTime, ...declineAction];
      }
      case "correction":
        return [primary(editing ? "Keep edited rule" : PRIMARY_ACTION.correction), editAction(), ...declineAction];
      case "plan": {
        const left = card.body.items.length - dropped.size;
        return [
          { ...primary(dropped.size ? `Approve ${left} of ${card.body.items.length}` : PRIMARY_ACTION.plan), disabled: left === 0 ? "Keep at least one item, or skip the card." : undefined },
          ...declineAction,
        ];
      }
    }
  })();

  // The price card shows its price large in the body; `meta` already names the account and time.
  const foot = [card.priceCredits !== null && card.kind !== "price" ? `${card.priceCredits} credits` : null, card.meta || null].filter(Boolean).join(" · ");
  const decided = decidedNote(card);
  /** The time picker's zone: a schedule card's, or a post card's that carries its time. */
  const pickerZone = card.body.kind === "schedule" ? card.body.timezone : proposed?.timezone ?? null;

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
            <PostBody
              body={card.body}
              cardId={card.id}
              editing={editing}
              draft={draft}
              onDraft={setDraft}
              onPick={setShown}
              onRewrite={canRewrite ? (platform) => void rewrite(platform) : undefined}
              rewriting={rewriting}
              photos={
                postItem && card.status === "waiting" && !editing && !card.body.platforms.some((p) => p.thread) ? (
                  <PostPhotos
                    itemId={postItem}
                    photos={card.body.photos ?? []}
                    sample={sample}
                    onError={toast}
                    onCard={(next) => {
                      if (next) setChanged({ from: given, card: next });
                      toast(next ? "Photos saved. Approve the post with them." : "Photos saved. Its schedule cards ask you again.");
                    }}
                  />
                ) : card.body.photos?.length ? (
                  <PhotoStrip photos={card.body.photos} label="Your photos, in posting order" />
                ) : null
              }
            />
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
            <SlideshowBody body={card.body} cardId={card.id} editable={captionsBlocked} edited={slideEdited} onSaveSlide={saveSlide} onSaveCaption={saveCaption} />
          ) : card.body.kind === "schedule" ? (
            <ScheduleBody body={card.body} cardId={card.id} options={options} onOptions={setOptions} onCopyPart={(post, index) => void copyPart(post, index)} editable={blocked ?? (busy ? "Wait for the decision to finish." : card.body.state === "failed" || card.body.state === "no_account" || card.body.state === "unconfirmed" ? "It posts as you approved it; change the time to start again." : null)} />
          ) : card.body.kind === "plan" ? (
            <PlanBody
              body={card.body}
              cardId={card.id}
              dropped={dropped}
              editable={captionsBlocked}
              onToggle={(itemId) =>
                setDropped((was) => {
                  const next = new Set(was);
                  if (!next.delete(itemId)) next.add(itemId);
                  return next;
                })
              }
            />
          ) : (
            <CorrectionBody body={card.body} editing={editing} draft={draft} onDraft={setDraft} />
          )}

          {card.body.kind === "post" && editing && draft.trim() !== shown && card.status === "waiting" ? (
            <ReasonChips label="What did you fix? Optional: your CMO learns from it." value={fixCode} onChange={setFixCode} only={FIX_REASONS} disabled={busy} />
          ) : null}
          {proposed ? (
            <p className="v2-card-meta" data-testid="post-when">
              {postWhen(proposed)}
            </p>
          ) : null}
          {card.autoAt && card.status === "waiting" ? (
            <p className="v2-card-state is-decided_elsewhere" data-testid="post-auto">
              <b>Autopilot</b>
              <span>{autoLabel(card.autoAt)}. Edit or skip it before then; Approve sends it to the schedule now.</span>
            </p>
          ) : null}
          {foot ? <div className="v2-card-meta">{foot}</div> : null}

          {"lookNote" in card.body && card.body.lookNote ? (
            <p className="v2-card-state is-expired" data-testid="look-note">
              <b>Look check</b>
              <span>{card.body.lookNote.replace(/^look check:\s*/i, "").replace(/^./, (c) => c.toUpperCase())}</span>
            </p>
          ) : null}

          {card.body.kind === "schedule" && card.body.lastError && !card.problem && card.status === "waiting" && card.body.state !== "waiting" ? (
            <p className={`v2-card-state ${card.body.state === "failed" || card.body.state === "unconfirmed" ? "is-failed" : "is-expired"}`}>
              <b>{STATE_LABEL[card.body.state]}</b>
              <span>
                {card.body.lastError}
                {card.body.state === "missed" ? " This is a new time: approve it, change it or cancel." : ""}
              </span>
            </p>
          ) : null}
          {card.body.kind === "schedule" && card.body.publishedUrl ? (
            <p className="v2-card-state is-decided_elsewhere">
              <b>Published</b>
              <a href={card.body.publishedUrl} target="_blank" rel="noopener noreferrer">
                Open the post
              </a>
            </p>
          ) : null}

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

          {moving && pickerZone ? (
            <form
              className="v2-card-decline"
              onSubmit={(event) => {
                event.preventDefault();
                const at = fromLocalInput(newTime, pickerZone);
                if (at) void run({ action: "change_time", publishAt: at });
              }}
            >
              <label className="v2-field" htmlFor={`${card.id}-time`}>
                <span>
                  {card.body.kind === "post"
                    ? `New time, your time (${pickerZone}). The card shows it before you approve.`
                    : `New time, your time (${pickerZone}). A new card asks you to approve it.`}
                </span>
                <input id={`${card.id}-time`} className="v2-input is-compact" type="datetime-local" required value={newTime} autoFocus onChange={(event) => setNewTime(event.target.value)} />
              </label>
              <div className="v2-actions">
                <Button type="submit" variant="primary" compact disabled={busy || !fromLocalInput(newTime, pickerZone)}>
                  Save new time
                </Button>
                <Button variant="quiet" compact onClick={() => setMoving(false)}>
                  Keep this time
                </Button>
              </div>
            </form>
          ) : declining && decline ? (
            <form
              className="v2-card-decline"
              onSubmit={(event) => {
                event.preventDefault();
                if (card.kind === "post") {
                  // Words of their own only with "Something else"; a chip alone says it.
                  const words = reasonCode === "OTHER" ? reason.trim() || undefined : undefined;
                  void run({ action: "skip", ...(reasonCode ? { reasonCode } : {}), ...(words ? { reason: words } : {}) });
                  return;
                }
                void run({ action: decline.action, reason: reason.trim() || undefined });
              }}
            >
              {card.kind === "post" ? (
                <ReasonChips label="Why skip it? Optional: your CMO learns from it." value={reasonCode} onChange={setReasonCode} disabled={busy} />
              ) : null}
              {card.kind !== "post" || reasonCode === "OTHER" ? (
                <label className="v2-field">
                  <span>{card.kind === "post" ? "What was wrong with it?" : "Why? Your CMO learns from it (optional)"}</span>
                  <input className="v2-input" value={reason} maxLength={400} autoFocus onChange={(event) => setReason(event.target.value)} />
                </label>
              ) : null}
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
                    disabled={busy || !!action.disabled || (!!blockedFor(action) && action.label !== "Stop editing")}
                    title={action.disabled ?? blockedFor(action) ?? undefined}
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
