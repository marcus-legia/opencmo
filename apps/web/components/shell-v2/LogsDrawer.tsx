"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Logs } from "@/app/api/v1/logs/route";
import { api } from "@/components/clipping/api";
import { Icon } from "@/components/icons";
import { DEPARTMENT_LABEL, type Department } from "@/lib/screens/common";

type Row =
  | { kind: "event"; id: string; at: string; who: Department; text: string }
  | { kind: "credit"; id: string; at: string; delta: number; reason: string };

const FILTERS = ["all", "credits", "brain", "writer", "studio", "schedule", "publish", "sales", "research"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { all: "All", credits: "Credits", ...DEPARTMENT_LABEL, brain: "CMO" };

const dayOf = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const timeOf = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * The Logs drawer (canvas Logs.dc.html): what the CMO did and what it cost, newest first. Opened from the top bar;
 * Escape or the scrim closes it and focus goes back to the button that opened it.
 */
export function LogsDrawer({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<Logs | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    void api<Logs>("/logs")
      .then(setLogs)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const rows = useMemo<Row[]>(() => {
    if (!logs) return [];
    const all: Row[] = [
      ...logs.events.map((e) => ({ kind: "event" as const, ...e })),
      ...logs.credits.map((c) => ({ kind: "credit" as const, ...c })),
    ];
    return all
      .filter((row) => filter === "all" || (filter === "credits" ? row.kind === "credit" : row.kind === "event" && row.who === filter))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [logs, filter]);

  // This week's spend and refunds, from the ledger itself (a hold is negative, a refund or grant positive).
  const sums = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    let spent = 0;
    let back = 0;
    for (const c of logs?.credits ?? []) {
      if (Date.parse(c.at) < since) continue;
      if (c.delta < 0) spent -= c.delta;
      else if (/refund/i.test(c.reason)) back += c.delta;
    }
    return { spent, back };
  }, [logs]);

  let lastDay = "";
  return (
    <>
      <div className="td-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <section className="td-drawer" role="dialog" aria-modal="true" aria-label="Logs" tabIndex={-1} ref={panel}>
        <div className="td-drawer-head">
          <Icon name="terminal" size={16} />
          <h2>Logs</h2>
          <span className="v2-mono is-muted">what your CMO did, and what it cost</span>
          <span className="td-spacer" />
          <button type="button" className="td-icon" aria-label="Close the logs" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="td-drawer-bar">
          <div className="v2-segmented" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f} type="button" className="v2-segment" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="td-drawer-sums">
          <span>
            <b className="v2-num">{sums.spent}</b> <span className="v2-mono is-muted">credits spent in 7 days</span>
          </span>
          <span>
            <b className="v2-num">{sums.back}</b> <span className="v2-mono is-muted">refunded</span>
          </span>
        </div>
        <div className="td-drawer-body">
          {failed ? <p className="td-ev-detail" style={{ padding: 20 }}>Could not load the logs. Close and open them again.</p> : null}
          {!failed && !logs ? <p className="td-ev-detail" style={{ padding: 20 }}>Loading…</p> : null}
          {logs && rows.length === 0 ? <p className="td-ev-detail" style={{ padding: 20 }}>Nothing here yet. Lines show up as your CMO works.</p> : null}
          {rows.map((row) => {
            const day = dayOf.format(new Date(row.at));
            const heading = day !== lastDay ? day : null;
            lastDay = day;
            const key = `${row.kind}-${row.id}`;
            const isOpen = open === key;
            const what = row.kind === "event" ? row.text : row.reason;
            return (
              <div key={key}>
                {heading ? <div className="td-day">{heading}</div> : null}
                <div className="td-ev">
                  <button type="button" className="td-ev-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                    <time className="td-ev-time" dateTime={row.at}>{timeOf.format(new Date(row.at))}</time>
                    <span className="td-ev-who">{row.kind === "event" ? FILTER_LABEL[row.who] : "Credits"}</span>
                    <span className="td-ev-what">{what}</span>
                    {row.kind === "credit" ? (
                      <span className={row.delta > 0 ? "td-ev-cost is-in" : "td-ev-cost"}>
                        {row.delta > 0 ? `+${row.delta}` : row.delta} cr
                      </span>
                    ) : null}
                  </button>
                  {isOpen && what.length > 70 ? <div className="td-ev-detail">{what}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
