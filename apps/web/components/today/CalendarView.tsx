"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";

import { AllowanceBanner, FreeLockedCard, useUsageState } from "@/components/billing/UsageNotice";
import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { PLATFORM_LABEL, type SlotStatus } from "@/lib/screens/common";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import type { ScheduleScreen } from "@/lib/screens/schedule";

import { PageHeader } from "./PageHeader";
import { PostingPlanPanel } from "./PostingPlanPanel";
import { SamplePosts } from "./SamplePosts";
import { useDecide } from "./useDecide";
import { PlatformMark, hasLogo } from "./platform-logos";

/** A slot, or a draft still waiting for the founder's OK drawn at the time its card proposes (`ghost`). */
type Slot = ScheduleScreen["slots"][number] & { ghost?: boolean };
const DAY_MS = 86_400_000;

/** The artboard's four states (Calendar.dc.html legend), from the slot statuses. */
type Tone = "accent" | "ok" | "warn" | "danger" | undefined;
const ST: Record<SlotStatus, [string, Tone]> = {
  proposed: ["Waiting on you", "accent"],
  waiting_founder: ["Waiting on you", "accent"],
  scheduled: ["Scheduled", undefined],
  posted: ["Posted", "ok"],
  failed: ["Failed", "danger"],
};

/**
 * The artboard's channel chips, one per platform a post can still go to (`CONNECTABLE_PLATFORMS`). TikTok and
 * Instagram left in wave 4b, Facebook and YouTube on 2026-11-22: a slot made before still shows under All.
 */
const CHANS = [
  { id: "all", label: "All", platforms: null },
  { id: "x", label: "X", platforms: ["x"] },
  { id: "linkedin", label: "LinkedIn", platforms: ["linkedin"] },
  { id: "threads", label: "Threads", platforms: ["threads"] },
] as const;
type ChanId = (typeof CHANS)[number]["id"];

/**
 * A slot's legend state. An approved post whose platform has no connected account never goes out on its own (owner,
 * 2026-11-24: "Scheduled" there made a founder think it would): it says the founder posts it.
 */
const unposted = (s: Slot) => s.status === "scheduled" && s.connected === false;
const stOf = (s: Slot): [string, Tone] => (unposted(s) ? ["Post it yourself", "warn"] : ST[s.status]);

/** Slots that have not started posting can move (the same rule as before the redesign). A waiting draft moves on its card. */
const MOVABLE: ReadonlySet<SlotStatus> = new Set(["proposed", "waiting_founder", "scheduled"]);
const movable = (s: Slot) => !s.ghost && MOVABLE.has(s.status);

/**
 * Post's one view switch (redesign 2026-11-28): List, Week and Month in a single control. Before, the Calendar showed
 * List/Week and Week/Month side by side. Links, so each view has its address (`?range=month`) and Back works.
 */
export function PostViews({ current, from }: { current: "list" | "week" | "month"; from?: string | null }) {
  const week = from ? `/app/schedule?from=${from}` : "/app/schedule";
  const month = `/app/schedule?${new URLSearchParams({ ...(from ? { from } : {}), range: "month" })}`;
  const item = (id: typeof current, label: string, href: string) => (
    <Link href={href} aria-current={current === id ? "page" : undefined} scroll={false}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Post view" className="ui-seg" data-testid="post-view-switch">
      {item("list", "List", "/app/writer")}
      {item("week", "Week", week)}
      {item("month", "Month", month)}
    </nav>
  );
}

/**
 * The drafts that wait for the founder's OK, at the time their card proposes (bug 4, 2026-11-28): only approved slots
 * were drawn, so a week with a draft waiting for today looked empty and "Waiting on you" matched nothing. A card that
 * already has a slot on the week is that slot, not a second item.
 */
function waitingDrafts(queue: Card[], slots: readonly Slot[], from: string, to: string): Slot[] {
  const taken = new Set(slots.flatMap((s) => (s.approvalId ? [s.approvalId] : [])));
  return queue.flatMap((c) => {
    if (c.body.kind !== "post" || !c.body.proposed || taken.has(c.id)) return [];
    const { at, platform, handle } = c.body.proposed;
    const t = Date.parse(at);
    if (!(t >= Date.parse(from) && t < Date.parse(to))) return [];
    return [{ id: `draft-${c.id}`, at, where: { platform, handle: handle ?? "" }, title: c.title, status: "waiting_founder" as const, note: null, approvalId: c.id, ghost: true }];
  });
}

function inZone(timezone: string) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  const clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  /** Minutes since local midnight. */
  const minutes = (t: number) => {
    const parts = Object.fromEntries(clockFmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Number(parts.hour) * 60 + Number(parts.minute);
  };
  return { dayKey: (t: string | number | Date) => dayFmt.format(new Date(t)), time: (t: string) => timeFmt.format(new Date(t)), minutes };
}
const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
const addDays = (key: string, n: number) => new Date(keyDate(key).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const label = (key: string, opts: Intl.DateTimeFormatOptions) => keyDate(key).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

/** Moves an instant to another calendar day in the founder's zone, keeping its time of day. */
function sameTimeOn(at: string, fromKey: string, toKey: string, minutesOf: (t: number) => number): string {
  const was = Date.parse(at);
  const moved = was + (keyDate(toKey).getTime() - keyDate(fromKey).getTime());
  // Whole days of 24 hours land an hour off across a daylight-saving change: put the local clock back where it was.
  let drift = minutesOf(was) - minutesOf(moved);
  if (drift > 720) drift -= 1440;
  if (drift < -720) drift += 1440;
  // To the minute, as the route asks (`approval-card.ts` refuses fractions of a second): `toISOString` writes ".000".
  return new Date(moved + drift * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Calendar (Calendar.dc.html): the week of slots, a chip per channel, the picked slot in the drawer on the right. A card
 * dragged to another day keeps its time and asks again (`change_time` gives it a new card, as before); Move sets an exact
 * time. SQL checks the posting rules and says why when it refuses. Drafts still waiting for the founder's OK show at
 * their proposed time, dashed, and open their card.
 */
export function CalendarView() {
  // `?from=YYYY-MM-DD` opens that week (a card's "See it in the calendar", the old Schedule screen's links);
  // `?range=month` the four weeks from it (Post's view switch).
  const params = useSearchParams();
  const asked = params.get("from");
  const range: "week" | "month" = params.get("range") === "month" ? "month" : "week";
  const usageState = useUsageState();
  const askedWeek = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const [from, setFrom] = useState<string | null>(askedWeek);
  // A link to another week while the Calendar is open (the component stays mounted) moves it there too.
  useEffect(() => {
    if (askedWeek) setFrom(askedWeek);
  }, [askedWeek]);
  const [state, reload] = useScreen("schedule", { ...(from ? { from } : {}), ...(range === "month" ? { range: "month" } : {}) });
  // The cards that wait, so a picked slot shows its post, versions and actions in the drawer (Calendar.dc.html).
  const [dash, reloadCards] = useScreen("dashboard");
  const { toast } = useShellState();
  const [chan, setChan] = useState<ChanId>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const data = state.status === "ready" ? state.data : null;
  const live = state.status === "ready" && state.live.slots;
  const zone = useMemo(() => inZone(data?.timezone ?? "UTC"), [data?.timezone]);

  const start = data ? zone.dayKey(data.from) : null;
  const end = data ? addDays(zone.dayKey(data.to), -1) : null;
  const days = start ? Array.from({ length: range === "month" ? 28 : 7 }, (_, i) => addDays(start, i)) : [];
  const today = zone.dayKey(Date.now());
  const only = CHANS.find((c) => c.id === chan)?.platforms ?? null;
  const queue = dash.status === "ready" ? ((dash.data as { queue: Card[] }).queue ?? []) : [];
  const sampleCards = !(dash.status === "ready" && (dash.live as { queue?: boolean }).queue);
  const allSlots: Slot[] = data ? [...data.slots, ...waitingDrafts(queue, data.slots, data.from, data.to)] : [];
  const slots = allSlots.filter((s) => !only || (only as readonly string[]).includes(s.where.platform)).map((s) => (moved[s.id] ? { ...s, at: moved[s.id]! } : s));
  const onDecide = useDecide(sampleCards, () => {
    reload();
    reloadCards();
  });
  // Nothing is open until the founder picks an item: the detail opens over the chat column (one working screen), and
  // Close now closes it. Before, the first waiting item was always shown and Close fell back to it.
  const sel = picked ? (slots.find((s) => s.id === picked) ?? null) : null;
  const selCard = sel?.approvalId ? queue.find((c) => c.id === sel.approvalId) : undefined;

  async function move(slot: Slot, publishAt: string) {
    if (!live) {
      toast("Sample calendar: nothing was moved.");
      return;
    }
    setMoved((m) => ({ ...m, [slot.id]: publishAt }));
    try {
      await api(`/schedule/slots/${encodeURIComponent(slot.id)}`, jsonBody({ action: "change_time", publishAt }));
      toast("New time saved. A new card asks you to approve it.");
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Could not move it. Please try again.");
    } finally {
      setMoved((m) => {
        const { [slot.id]: _, ...rest } = m;
        return rest;
      });
      reload();
    }
  }

  function drop(event: DragEvent, key: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    const slot = slots.find((s) => s.id === id);
    if (!slot || !movable(slot)) return;
    const fromKey = zone.dayKey(slot.at);
    if (fromKey !== key) void move(slot, sameTimeOn(slot.at, fromKey, key, zone.minutes));
  }

  const span = start && end ? (range === "month" ? `${label(start, { day: "numeric", month: "short" })} – ${label(end, { day: "numeric", month: "short", year: "numeric" })}` : `${label(start, { day: "numeric" })} – ${label(end, { day: "numeric", month: "long" })}`) : null;
  const step = (dir: -1 | 1) => start && setFrom(addDays(start, dir * (range === "month" ? 28 : 7)));
  const chanName = (s: Slot) => PLATFORM_LABEL[s.where.platform];
  const waitingCount = slots.filter((s) => s.status === "waiting_founder" || s.status === "proposed").length;
  const status = data
    ? [waitingCount ? `${waitingCount} waiting on you` : "Nothing waiting on you", `times in ${data.timezone}`].join(" · ")
    : state.status === "loading"
      ? "Loading the week…"
      : null;

  return (
    <div className="ui-post pc" data-testid="v2-schedule" data-range={range}>
      <main className="pc-main">
        <PageHeader title="Post calendar" status={status} actions={<PostViews current={range} from={from} />}>
          <div className="pc-bar">
            <div className="pc-nav">
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm" aria-label={range === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setFrom(null)}>
                Today
              </button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm" aria-label={range === "month" ? "Next month" : "Next week"} onClick={() => step(1)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
              {span ? <span className="pc-span ui-num">{span}</span> : null}
            </div>
            <div role="group" aria-label="Platform" className="ui-row">
              {CHANS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="ui-chip pw-logo-chip"
                  aria-pressed={chan === c.id}
                  onClick={() => setChan(c.id)}
                  aria-label={c.id === "all" ? undefined : c.label}
                  title={c.id === "all" ? undefined : c.label}
                >
                  {c.id !== "all" && hasLogo(c.id) ? <PlatformMark platform={c.id} size={15} /> : c.label}
                </button>
              ))}
            </div>
          </div>
        </PageHeader>

        <AllowanceBanner state={usageState} />
        <FreeLockedCard state={usageState} where="post" />
        {/* A free account cannot connect, so nothing is written for it: fixed samples show what Post makes instead. */}
        {live && usageState?.plan === "free" && data && !data.accounts.some((a) => a.status === "connected") ? <SamplePosts /> : null}

        {state.status === "error" ? <p className="ui-t-sm ui-muted">{state.message}</p> : null}

        {data ? (
          <>
            <div className="pc-legend ui-t-xs ui-muted">
              <span className="ui-chip pc-ghost-chip" data-tone="accent">
                Waiting on you
              </span>
              <span className="ui-chip">Scheduled</span>
              {slots.some(unposted) ? (
                <span>
                  <span className="ui-chip" data-tone="warn">
                    Post it yourself
                  </span>{" "}
                  no account connected
                </span>
              ) : null}
              <span className="ui-chip" data-tone="ok">
                Posted
              </span>
              <span className="ui-chip" data-tone="danger">
                Failed
              </span>
              <span className="pc-legend__hint">Drag a post to another day to move it. Ferreto asks before it changes a time.</span>
            </div>
            <div className="pc-grid" data-range={range}>
              {days.map((key) => {
                const items = slots.filter((s) => zone.dayKey(s.at) === key).sort((a, b) => a.at.localeCompare(b.at));
                return (
                  <div key={key} className="pc-day" data-today={key === today || undefined} data-empty={items.length ? undefined : ""} data-day={key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, key)}>
                    <div className="pc-day__head">
                      <span>{label(key, { weekday: "short" })}</span>
                      <b className="ui-num">{label(key, { day: "numeric" })}</b>
                    </div>
                    {items.map((e) => {
                      const [stLabel, tone] = stOf(e);
                      return (
                        <button
                          key={e.id}
                          type="button"
                          className="pc-ev"
                          data-slot-id={e.ghost ? undefined : e.id}
                          data-ghost={e.ghost || undefined}
                          data-testid={e.ghost ? "calendar-waiting-draft" : undefined}
                          aria-pressed={sel?.id === e.id}
                          draggable={movable(e)}
                          onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)}
                          onClick={() => setPicked(e.id)}
                        >
                          <span className="pc-ev__time ui-num">
                            {hasLogo(e.where.platform) ? <PlatformMark platform={e.where.platform} size={12} /> : null}
                            {zone.time(e.at)}
                            <span className={hasLogo(e.where.platform) ? "v2-visually-hidden" : undefined}> · {chanName(e)}</span>
                          </span>
                          <span className="pc-ev__title">{e.title}</span>
                          <span className="pc-ev__state">
                            {e.status === "failed" ? <FailedMark /> : null}
                            <span className="ui-chip" data-tone={tone} data-testid="slot-state">
                              {stLabel}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {!sel && !slots.length ? (
          <p className="ui-t-sm ui-muted pc-empty" data-testid="calendar-empty">
            {/* Until the week is read, "nothing on the calendar" would be a guess. */}
            {data ? `Nothing on the calendar this ${range}. Drafts waiting for your OK and approved posts show here at their time.` : state.status === "error" ? null : "Loading…"}
          </p>
        ) : null}

        {data ? (
          <PostingPlanPanel initial={data.postingPlan} accounts={data.accounts} live={state.status === "ready" && state.live.postingPlan} onSaved={reload} />
        ) : null}
      </main>

      <aside className="drawer pc-drawer" aria-label="Selected item" hidden={!sel}>
        {sel ? (
          <>
            <div className="pc-drawer__head">
              <span className="ui-t-sm">
                <b>{chanName(sel)}</b>{" "}
                <span className="ui-muted ui-num">
                  · {label(zone.dayKey(sel.at), { weekday: "short", day: "numeric", month: "short" })} {zone.time(sel.at)}
                </span>
              </span>
              <button type="button" className="ui-btn ui-btn--quiet ui-btn--icon ui-btn--sm" aria-label="Close" onClick={() => setPicked(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div className="pc-drawer__body">
              <div>
                <span className="ui-chip" data-tone={stOf(sel)[1]}>
                  {stOf(sel)[0]}
                </span>
              </div>
              <h2 className="pc-drawer__title">{sel.title}</h2>
              <p className="ui-t-xs ui-muted">
                {sel.ghost ? "A draft: approve it on its card and it goes out at this time." : sel.where.handle ? `${chanName(sel)} · ${sel.where.handle}` : chanName(sel)}
                {sel.note && !(unposted(sel) && sel.note === "post it yourself") ? ` · ${sel.note}` : ""}
              </p>
              {unposted(sel) ? (
                <p className="ui-t-sm ui-muted" data-testid="slot-not-connected">
                  No {chanName(sel)} account is connected, so this does not go out on its own. Post it yourself at this time, or connect {chanName(sel)} and it goes out by itself.
                </p>
              ) : null}
              {selCard ? (
                <div className="td-cardhost">
                  <ApprovalCard card={selCard} sample={sampleCards} onDecide={onDecide} open />
                </div>
              ) : null}
              {moving === sel.id ? (
                <MoveForm slot={sel} timezone={data?.timezone ?? "UTC"} onCancel={() => setMoving(null)} onMove={(at) => (setMoving(null), void move(sel, at))} />
              ) : null}
            </div>
            <div className="pc-drawer__foot">
              {movable(sel) ? (
                <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setMoving(sel.id)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="18" height="18" x="3" y="4" rx="2" />
                    <path d="M16 2v4" />
                    <path d="M8 2v4" />
                    <path d="M3 10h18" />
                  </svg>
                  Move
                </button>
              ) : null}
              {sel.approvalId && (sel.status === "waiting_founder" || sel.status === "proposed") && !selCard ? (
                <Link href={`/app/inbox/${encodeURIComponent(sel.approvalId)}`} className="ui-btn ui-btn--primary">
                  Review and approve
                </Link>
              ) : sel.url ? (
                <a href={sel.url} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--primary">
                  Open the post
                </a>
              ) : sel.status === "failed" && sel.approvalId && !selCard ? (
                // A post that did not go out stays on its day; its card offers Retry at the approved time.
                <Link href={`/app/inbox/${encodeURIComponent(sel.approvalId)}`} className="ui-btn ui-btn--primary">
                  Retry
                </Link>
              ) : unposted(sel) ? (
                <Link href="/app/settings#settings-connected-accounts" className="ui-btn ui-btn--primary" data-testid="slot-connect">
                  Connect {chanName(sel)}
                </Link>
              ) : sel.status === "failed" && sel.note !== "missed" && !sel.approvalId ? (
                <Link href="/app/settings#settings-connected-accounts" className="ui-btn ui-btn--primary">
                  Fix the account
                </Link>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

/** A post that did not go out: an alert mark next to its status, so it stands out on the week. */
function FailedMark() {
  return (
    <svg className="pc-failed" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Did not go out">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/** Move to an exact day and time, in the founder's zone. */
function MoveForm({ slot, timezone, onMove, onCancel }: { slot: Slot; timezone: string; onMove: (at: string) => void; onCancel: () => void }) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(slot.at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const [value, setValue] = useState(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`);
  function submit() {
    // The wall time in the founder's zone → an instant: shift by the zone's offset at that moment.
    const guess = Date.parse(`${value}:00Z`);
    const offset = Date.parse(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })) - Date.parse(new Date(guess).toLocaleString("en-US", { timeZone: timezone }));
    onMove(new Date(guess + offset).toISOString());
  }
  return (
    <div className="pc-move">
      <label className="ui-label" htmlFor="move-at">
        New time ({timezone})
      </label>
      <input id="move-at" className="ui-input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="ui-row pc-move__acts">
        <button type="button" className="ui-btn ui-btn--quiet" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ui-btn ui-btn--primary" onClick={submit}>
          Save the time
        </button>
      </div>
    </div>
  );
}
