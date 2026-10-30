"use client";

import { useMemo, useState } from "react";

import { Button, Segmented } from "@/components/ui";
import { PLATFORM_LABEL, type Platform, type SlotStatus } from "@/lib/screens/common";
import type { ScheduleScreen as Data } from "@/lib/screens/schedule";

import { cx, ErrorNote, PageHeader, Panel, Pills, Screen, SkeletonBlocks } from "../parts";
import { useTabParam } from "../useTabParam";
import { isSample, useScreen } from "../useScreen";

type Slot = Data["slots"][number];

const VIEWS = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const FILTERS = ["all", "x", "linkedin", "threads", "tiktok", "youtube", "instagram"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_TEXT: Record<SlotStatus, string> = {
  proposed: "Proposed",
  waiting_founder: "Time waits on you",
  scheduled: "Scheduled",
  posted: "Posted",
  failed: "Failed",
};

const DAY_MS = 86_400_000;

/** Calendar helpers that read every time in the founder's zone, not the browser's. */
function inZone(timezone: string) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  return {
    dayKey: (t: string | number | Date) => dayFmt.format(new Date(t)),
    time: (t: string) => timeFmt.format(new Date(t)),
  };
}

/** A `YYYY-MM-DD` key as a UTC noon date: safe to add days to and to label, whatever the zone. */
const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);
const label = (key: string, opts: Intl.DateTimeFormatOptions) => keyDate(key).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
const addDays = (key: string, n: number) => new Date(keyDate(key).getTime() + n * DAY_MS).toISOString().slice(0, 10);

export function ScheduleScreen() {
  const [from, setFrom] = useState<string | null>(null);
  const [state] = useScreen("schedule", from ? { from } : {});
  const [view, setView] = useTabParam<View>("view", VIEWS.map((v) => v.id), "week");
  const [filter, setFilter] = useState<Filter>("all");
  const data = state.status === "ready" ? state.data : null;
  const zone = useMemo(() => inZone(data?.timezone ?? "UTC"), [data?.timezone]);
  const start = data ? zone.dayKey(data.from) : null;
  const end = data ? addDays(zone.dayKey(data.to), -1) : null;

  const title =
    start && end
      ? view === "month"
        ? label(start, { month: "long", year: "numeric" })
        : `${label(start, { day: "numeric", month: "short" })} – ${label(end, { day: "numeric", month: "short" })}`
      : "Schedule";
  const step = (dir: -1 | 1) => start && setFrom(addDays(start, dir * (view === "month" ? 28 : 7)));

  return (
    <Screen label="Schedule">
      <PageHeader
        numeral="V"
        eyebrow="Schedule"
        title={title}
        sub={data ? `Your time: ${data.timezone} · everything posts through your connected accounts` : undefined}
        sample={state.status === "ready" && isSample(state.live)}
        actions={
          <>
            <Segmented<View> label="View" items={[...VIEWS]} value={view} onChange={setView} />
            <Button variant="secondary" icon aria-label="Previous" onClick={() => step(-1)}>
              ‹
            </Button>
            <Button variant="secondary" icon aria-label="Next" onClick={() => step(1)}>
              ›
            </Button>
          </>
        }
      />
      <Pills
        label="Platform"
        options={FILTERS.map((f) => ({ id: f, label: f === "all" ? "All platforms" : f === "youtube" ? "YouTube" : PLATFORM_LABEL[f as Platform] }))}
        value={filter}
        onChange={setFilter}
      />
      {state.status === "loading" && <SkeletonBlocks />}
      {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      {data && start && end && (
        <div className="scr-split">
          <div className="scr-main">
            <Calendar
              view={view}
              slots={data.slots.filter((s) => filter === "all" || s.where.platform === filter)}
              start={start}
              end={end}
              zone={zone}
            />
          </div>
          <div className="scr-side">
            <Panel id="schedule-accounts" title="Accounts">
              <div className="scr-rows">
                {data.accounts.length === 0 && <p className="scr-row scr-muted">No accounts yet.</p>}
                {data.accounts.map((a) => (
                  <div key={a.id} className="scr-row scr-row-inline">
                    <span>
                      {PLATFORM_LABEL[a.platform]}
                      {a.handle ? ` · ${a.handle}` : ""}
                    </span>
                    {a.status === "connected" ? (
                      <span className="scr-status is-ok">Connected</span>
                    ) : (
                      <a href="/app/settings#settings-connected-accounts" className="scr-status is-stuck">
                        {a.status === "reconnect" ? "Reconnect" : "Connect"}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
            {data.rules.length > 0 && (
              <Panel id="schedule-posting-rules" title="Posting rules">
                <div className="v2-panel-body scr-rules">
                  {data.rules.map((rule, i) => (
                    <p key={rule} className={i === data.rules.length - 1 ? "scr-muted" : undefined}>
                      {rule}
                    </p>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </Screen>
  );
}

type Zone = ReturnType<typeof inZone>;

function Calendar({ view, slots, start, end, zone }: { view: View; slots: Slot[]; start: string; end: string; zone: Zone }) {
  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of [...slots].sort((a, b) => a.at.localeCompare(b.at))) {
      const key = zone.dayKey(slot.at);
      map.set(key, [...(map.get(key) ?? []), slot]);
    }
    return map;
  }, [slots, zone]);
  const today = zone.dayKey(Date.now());

  if (view === "list") {
    const keys = [...byDay.keys()].sort();
    return (
      <Panel id="schedule-every-slot-in-this-range" title="Every slot in this range">
        <div className="scr-rows">
          {keys.length === 0 && <p className="scr-row scr-muted">Nothing scheduled in this range.</p>}
          {keys.map((key) => (
            <div key={key} className="scr-list-day">
              <h3 className="scr-mono is-small">{label(key, { weekday: "short", day: "numeric", month: "short" })}</h3>
              {byDay.get(key)!.map((slot) => (
                <SlotCard key={slot.id} slot={slot} zone={zone} inline />
              ))}
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  if (view === "month") {
    // Weeks Monday to Sunday around the range's month.
    const first = `${start.slice(0, 7)}-01`;
    const weekday = (keyDate(first).getUTCDay() + 6) % 7;
    const gridStart = addDays(first, -weekday);
    const month = start.slice(0, 7);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    return (
      <div className="scr-month" role="grid" aria-label={label(first, { month: "long", year: "numeric" })}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="scr-month-head scr-mono is-small" role="columnheader">
            {d}
          </span>
        ))}
        {days.map((key) => {
          const list = byDay.get(key) ?? [];
          return (
            <div key={key} role="gridcell" className={cx("scr-month-day", key.slice(0, 7) !== month && "is-out", key === today && "is-today")}>
              <span className="scr-num scr-tiny">{Number(key.slice(8))}</span>
              {list.slice(0, 3).map((slot) => (
                <span key={slot.id} className={cx("scr-month-slot", `is-${slot.status}`)} title={`${zone.time(slot.at)} ${PLATFORM_LABEL[slot.where.platform]} · ${slot.title}`}>
                  {zone.time(slot.at)} {PLATFORM_LABEL[slot.where.platform]}
                </span>
              ))}
              {list.length > 3 && <span className="scr-tiny scr-muted">+{list.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    );
  }

  const days: string[] = [];
  for (let key = start; key <= end && days.length < 7; key = addDays(key, 1)) days.push(key);
  return (
    <div className="scr-week-wrap">
      <div className="scr-week">
        {days.map((key) => {
          const list = byDay.get(key) ?? [];
          const sunday = keyDate(key).getUTCDay() === 0;
          return (
            <section key={key} className={cx("scr-week-day", key === today && "is-today")} aria-label={label(key, { weekday: "long", day: "numeric", month: "long" })}>
              <h3 className="scr-week-head scr-mono is-small">
                {label(key, { weekday: "short" })} {Number(key.slice(8))}
                {key === today ? " · today" : ""}
              </h3>
              <div className="scr-week-slots">
                {list.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} zone={zone} />
                ))}
                {sunday && list.length === 0 && <p className="scr-slot is-note">Sunday review: no posts by default</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SlotCard({ slot, zone, inline }: { slot: Slot; zone: Zone; inline?: boolean }) {
  const status = slot.status === "failed" && slot.note ? `${STATUS_TEXT.failed} · ${slot.note}` : STATUS_TEXT[slot.status];
  const extra = slot.status === "posted" && slot.note ? ` · ${slot.note}` : "";
  const body = (
    <>
      <span>
        <span className="scr-num">{zone.time(slot.at)}</span> {PLATFORM_LABEL[slot.where.platform]}
      </span>
      <span>{slot.title}</span>
      <span className="scr-slot-status">
        {status}
        {extra}
      </span>
    </>
  );
  const cls = cx("scr-slot", `is-${slot.status}`, inline && "is-inline");
  if (slot.approvalId) {
    return (
      <a href={`/app/inbox/${encodeURIComponent(slot.approvalId)}`} className={cls}>
        {body}
      </a>
    );
  }
  if (slot.status === "failed") {
    return (
      <a href="/app/settings#settings-connected-accounts" className={cls}>
        {body}
      </a>
    );
  }
  return <div className={cls}>{body}</div>;
}

