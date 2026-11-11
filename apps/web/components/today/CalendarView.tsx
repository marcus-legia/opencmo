"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";

import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { PLATFORM_LABEL, type SlotStatus } from "@/lib/screens/common";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import type { ScheduleScreen } from "@/lib/screens/schedule";

import { useDecide } from "./useDecide";

type Slot = ScheduleScreen["slots"][number];
const DAY_MS = 86_400_000;

/** The artboard's four states (Calendar.dc.html legend), from the slot statuses. */
const ST: Record<SlotStatus, [string, string]> = {
  proposed: ["Waiting on you", "st wait"],
  waiting_founder: ["Waiting on you", "st wait"],
  scheduled: ["Scheduled", "st sch"],
  posted: ["Posted", "st post"],
  failed: ["Failed", "st make"],
};

/** The artboard's channel chips; Video covers the platforms short videos go to. */
const CHANS = [
  { id: "all", label: "All", platforms: null },
  { id: "x", label: "X", platforms: ["x"] },
  { id: "linkedin", label: "LinkedIn", platforms: ["linkedin"] },
  { id: "video", label: "Video", platforms: ["tiktok", "youtube", "instagram"] },
  { id: "threads", label: "Threads", platforms: ["threads"] },
] as const;
type ChanId = (typeof CHANS)[number]["id"];

/** Slots that have not started posting can move (the same rule as before the redesign). */
const MOVABLE: ReadonlySet<SlotStatus> = new Set(["proposed", "waiting_founder", "scheduled"]);

function inZone(timezone: string) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  return { dayKey: (t: string | number | Date) => dayFmt.format(new Date(t)), time: (t: string) => timeFmt.format(new Date(t)) };
}
const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
const addDays = (key: string, n: number) => new Date(keyDate(key).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const label = (key: string, opts: Intl.DateTimeFormatOptions) => keyDate(key).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

/** Moves an instant to another calendar day in the founder's zone, keeping its time of day. */
function sameTimeOn(at: string, fromKey: string, toKey: string): string {
  // To the minute, as the route asks (`approval-card.ts` refuses fractions of a second): `toISOString` writes ".000".
  return new Date(Date.parse(at) + (keyDate(toKey).getTime() - keyDate(fromKey).getTime())).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Calendar (Calendar.dc.html): the week of slots, a chip per channel, the picked slot in the drawer on the right. A card
 * dragged to another day keeps its time and asks again (`change_time` gives it a new card, as before); Move sets an exact
 * time. SQL checks the posting rules and says why when it refuses.
 */
export function CalendarView() {
  // `?from=YYYY-MM-DD` opens that week (a card's "See it in the calendar", the old Schedule screen's links).
  const asked = useSearchParams().get("from");
  const askedWeek = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const [from, setFrom] = useState<string | null>(askedWeek);
  // A link to another week while the Calendar is open (the component stays mounted) moves it there too.
  useEffect(() => {
    if (askedWeek) setFrom(askedWeek);
  }, [askedWeek]);
  const [range, setRange] = useState<"week" | "month">("week");
  const [state, reload] = useScreen("schedule", from ? { from } : {});
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
  const slots = (data?.slots ?? []).filter((s) => !only || (only as readonly string[]).includes(s.where.platform)).map((s) => (moved[s.id] ? { ...s, at: moved[s.id]! } : s));
  const queue = dash.status === "ready" ? ((dash.data as { queue: Card[] }).queue ?? []) : [];
  const onDecide = useDecide(!(dash.status === "ready" && (dash.live as { queue?: boolean }).queue), () => {
    reload();
    reloadCards();
  });
  const sel = slots.find((s) => s.id === picked) ?? slots.find((s) => s.status === "waiting_founder" || s.status === "proposed") ?? slots[0] ?? null;

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
    if (!slot || !MOVABLE.has(slot.status)) return;
    const fromKey = zone.dayKey(slot.at);
    if (fromKey !== key) void move(slot, sameTimeOn(slot.at, fromKey, key));
  }

  const title = start && end ? (range === "month" ? label(start, { month: "long", year: "numeric" }) : `${label(start, { day: "numeric" })} – ${label(end, { day: "numeric", month: "long" })}`) : "Calendar";
  const step = (dir: -1 | 1) => start && setFrom(addDays(start, dir * (range === "month" ? 28 : 7)));
  const chanName = (s: Slot) => PLATFORM_LABEL[s.where.platform];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", minHeight: "calc(100vh - 48px)" }} data-testid="v2-schedule">
      <main style={{ flex: "1 1 640px", minWidth: "0", padding: "16px 20px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
          <button type="button" className="ib" aria-label={range === "month" ? "Previous month" : "Previous week"} onClick={() => step(-1)}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 style={{ margin: "0", fontSize: "20px", fontWeight: "600", letterSpacing: "-0.3px" }}>{title}</h1>
          <button type="button" className="ib" aria-label={range === "month" ? "Next month" : "Next week"} onClick={() => step(1)}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <button type="button" className="pill" onClick={() => setFrom(null)}>
            Today
          </button>
          <div className="seg" role="tablist" aria-label="Range">
            <button type="button" role="tab" aria-selected={range === "week"} onClick={() => setRange("week")}>
              Week
            </button>
            <button type="button" role="tab" aria-selected={range === "month"} onClick={() => setRange("month")}>
              Month
            </button>
          </div>
          <div style={{ flex: "1 1 auto" }}></div>
          {CHANS.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={chan === c.id} onClick={() => setChan(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "10px" }} className="meta">
          <span>
            <span className="st wait">Waiting on you</span>
          </span>
          <span>
            <span className="st sch">Scheduled</span>
          </span>
          <span>
            <span className="st post">Posted</span>
          </span>
          <span>
            <span className="st make">Failed</span>
          </span>
          <span style={{ marginLeft: "auto" }}>Drag a card to another day to move it. Your CMO asks before it changes a time.</span>
        </div>

        {state.status === "error" ? <div className="meta">{state.message}</div> : null}
        {state.status === "loading" ? <div className="meta">Loading the week…</div> : null}

        {data ? (
          <div className="grid">
            {days.map((key) => {
              const items = slots.filter((s) => zone.dayKey(s.at) === key).sort((a, b) => a.at.localeCompare(b.at));
              return (
                <div
                  key={key}
                  className={key === today ? "day today" : "day"}
                  data-day={key}
                  style={range === "month" ? { minHeight: "140px", borderBottom: "1px solid var(--line)" } : undefined}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, key)}
                >
                  <div className="dh">
                    <span className="meta">{label(key, { weekday: "short" })}</span>
                    <b style={{ fontSize: "14px", fontWeight: "600" }}>{label(key, { day: "numeric" })}</b>
                  </div>
                  {items.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className="ev"
                      data-slot-id={e.id}
                      aria-pressed={sel?.id === e.id}
                      draggable={MOVABLE.has(e.status)}
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)}
                      onClick={() => setPicked(e.id)}
                    >
                      <span className="t">
                        {zone.time(e.at)} · {chanName(e)}
                      </span>
                      <span className="n">{e.title}</span>
                      <span>
                        <span className={ST[e.status][1]}>{ST[e.status][0]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
      </main>

      <aside className="drawer" aria-label="Selected item">
        {sel ? (
          <>
            <div style={{ height: "48px", display: "flex", alignItems: "center", gap: "8px", padding: "0 12px 0 16px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontWeight: "600" }}>{chanName(sel)}</span>
              <span className="meta">
                · {label(zone.dayKey(sel.at), { weekday: "short", day: "numeric", month: "short" })} {zone.time(sel.at)}
              </span>
              <div style={{ flex: "1 1 auto" }}></div>
              <button type="button" className="ib" aria-label="Close" onClick={() => setPicked(null)}>
                <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", flex: "1 1 auto" }}>
              <div>
                <span className={ST[sel.status][1]}>{ST[sel.status][0]}</span>
              </div>
              <h2 style={{ margin: "0", fontSize: "17px", fontWeight: "600", letterSpacing: "-0.2px" }}>{sel.title}</h2>
              <div className="meta">
                {sel.where.handle ? `${chanName(sel)} · ${sel.where.handle}` : chanName(sel)}
                {sel.note ? ` · ${sel.note}` : ""}
              </div>
              {(() => {
                const card = sel.approvalId ? queue.find((c) => c.id === sel.approvalId) : undefined;
                return card ? (
                  <div className="td-cardhost">
                    <ApprovalCard card={card} sample={!(dash.status === "ready" && (dash.live as { queue?: boolean }).queue)} onDecide={onDecide} open />
                  </div>
                ) : null;
              })()}
              {moving === sel.id ? (
                <MoveForm slot={sel} timezone={data?.timezone ?? "UTC"} onCancel={() => setMoving(null)} onMove={(at) => (setMoving(null), void move(sel, at))} />
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              {MOVABLE.has(sel.status) ? (
                <button type="button" className="ghost" onClick={() => setMoving(sel.id)}>
                  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                    <rect width="18" height="18" x="3" y="4" rx="2" />
                    <path d="M16 2v4" />
                    <path d="M8 2v4" />
                    <path d="M3 10h18" />
                  </svg>
                  Move
                </button>
              ) : null}
              {sel.approvalId && (sel.status === "waiting_founder" || sel.status === "proposed") && !queue.some((c) => c.id === sel.approvalId) ? (
                <Link href={`/app/inbox/${encodeURIComponent(sel.approvalId)}`} className="primary" style={{ textDecoration: "none" }}>
                  Review and approve
                </Link>
              ) : sel.url ? (
                <a href={sel.url} target="_blank" rel="noopener noreferrer" className="primary" style={{ textDecoration: "none" }}>
                  Open the post
                </a>
              ) : sel.status === "failed" ? (
                <Link href="/app/settings#settings-connected-accounts" className="primary" style={{ textDecoration: "none" }}>
                  Fix the account
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <div style={{ padding: "16px" }} className="meta">
            Nothing on the calendar this week. Approved posts show here at their time.
          </div>
        )}
      </aside>
    </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <label className="meta" htmlFor="move-at">
        New time ({timezone})
      </label>
      <input id="move-at" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} style={{ height: "32px", padding: "0 8px", border: "1px solid var(--line-2)", borderRadius: "7px", background: "var(--bg)", color: "var(--text)", font: "inherit" }} />
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={submit}>
          Save the time
        </button>
      </div>
    </div>
  );
}
