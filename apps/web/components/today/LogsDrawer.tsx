"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Logs } from "@/app/api/v1/logs/route";
import { api } from "@/components/clipping/api";
import type { Department } from "@/lib/screens/common";

/** The canvas's filters (Logs.dc.html) and the departments each one covers. */
const FILTERS = [
  { id: "all", label: "All", who: null },
  { id: "cmo", label: "CMO", who: ["brain", "research"] },
  { id: "writer", label: "Writer", who: ["writer"] },
  { id: "video", label: "Video", who: ["studio"] },
  { id: "post", label: "Post", who: ["schedule", "publish"] },
  { id: "sales", label: "Sales", who: ["sales"] },
] as const satisfies readonly { id: string; label: string; who: readonly Department[] | null }[];
type FilterId = (typeof FILTERS)[number]["id"];

const AGENT: Record<Department, string> = { brain: "CMO", research: "CMO", writer: "Writer", studio: "Video", schedule: "Post", publish: "Post", sales: "Sales" };

type Row = { key: string; at: string; agent: string; who: Department | null; what: string; cost: string; tone: "ok" | "bad"; held: string; spent: string; back: string };

/** A line that reads as a problem: shown with the warning mark and kept by "Only problems". */
const PROBLEM = /\b(fail|failed|stuck|blocked|could not|refund)/i;

const timeOf = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short" }).format(d);
};

/**
 * The Logs drawer (Logs.dc.html): what the CMO did and what it cost, newest first. Its markup and classes are the
 * artboard's, so it renders inside its own `k pg-logs` layer over whichever screen opened it.
 */
export function LogsDrawer({ onClose, running = 0 }: { onClose: () => void; running?: number }) {
  const [logs, setLogs] = useState<Logs | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<FilterId>("all");
  const [problems, setProblems] = useState(false);
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
      if (event.key !== "Tab" || !panel.current) return;
      // A modal dialog keeps focus inside.
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button, [href]")].filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const rows = useMemo<Row[]>(() => {
    if (!logs) return [];
    const events: Row[] = logs.events.map((e) => ({
      key: `e-${e.id}`,
      at: e.at,
      agent: AGENT[e.who],
      who: e.who,
      what: e.text,
      cost: "",
      tone: PROBLEM.test(e.text) ? "bad" : "ok",
      held: "",
      spent: "",
      back: "",
    }));
    const credits: Row[] = logs.credits.map((c) => ({
      key: `c-${c.id}`,
      at: c.at,
      agent: "Credits",
      who: null,
      what: c.reason,
      cost: `${c.delta > 0 ? "+" : ""}${c.delta} cr`,
      tone: "ok",
      held: c.delta < 0 ? `${-c.delta} cr` : "0 cr",
      spent: c.delta < 0 ? `${-c.delta} cr` : "0 cr",
      back: c.delta > 0 ? `${c.delta} cr` : "0 cr",
    }));
    const only = FILTERS.find((f) => f.id === filter)?.who ?? null;
    return [...events, ...credits]
      .filter((r) => (only ? r.who !== null && (only as readonly string[]).includes(r.who) : true))
      .filter((r) => (problems ? r.tone === "bad" : true))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [logs, filter, problems]);

  // Rendered into <body>: the screen behind keeps its own `pg-*` CSS away from the drawer's.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  let lastDay = "";
  return createPortal(
    <div className="k pg-logs td-layer">
      <div aria-hidden="true" className="td-layer-scrim" onClick={onClose}></div>
      <section
        aria-label="Logs"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={panel}
        style={{ position: "relative", flex: "0 1 600px", minWidth: "0", background: "var(--panel)", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", boxShadow: "-12px 0 32px rgba(0,0,0,.18)" }}
      >
        <div style={{ height: "52px", display: "flex", alignItems: "center", gap: "8px", padding: "0 12px 0 20px", borderBottom: "1px solid var(--line)" }}>
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--muted)" }}>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" x2="20" y1="19" y2="19" />
          </svg>
          <span style={{ fontWeight: "600", fontSize: "14px" }}>Logs</span>
          <span className="meta">· what your CMO did, and what it cost</span>
          <div style={{ flex: "1 1 auto" }}></div>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <div className="seg" role="tablist" aria-label="Agent">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ flex: "1 1 auto" }}></div>
          <button type="button" className="pill" aria-pressed={problems} onClick={() => setProblems((p) => !p)}>
            Only problems
          </button>
        </div>

        <div style={{ display: "flex", gap: "16px", padding: "10px 20px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
          <span>
            <b style={{ fontWeight: "600" }}>{logs?.week.spent ?? 0}</b> <span className="meta">credits spent this week</span>
          </span>
          <span>
            <b style={{ fontWeight: "600" }}>{logs?.week.returned ?? 0}</b> <span className="meta">refunded</span>
          </span>
          <span>
            <b style={{ fontWeight: "600" }}>{running}</b> <span className="meta">running now</span>
          </span>
        </div>

        <div style={{ flex: "1 1 auto", overflow: "auto" }}>
          {failed ? <div className="meta" style={{ padding: "12px 20px" }}>Could not load the logs. Close and open them again.</div> : null}
          {!failed && !logs ? <div className="meta" style={{ padding: "12px 20px" }}>Loading…</div> : null}
          {logs && rows.length === 0 ? <div className="meta" style={{ padding: "12px 20px" }}>Nothing here yet. Lines show up as your CMO works.</div> : null}
          {rows.map((e) => {
            const day = dayOf(e.at);
            const heading = day !== lastDay ? day : null;
            lastDay = day;
            const isOpen = open === e.key;
            return (
              <div key={e.key}>
                {heading ? (
                  <div className="meta" style={{ padding: "12px 20px 4px", textTransform: "uppercase", letterSpacing: ".05em", fontSize: "10.5px" }}>
                    {heading}
                  </div>
                ) : null}
                <div className="ev">
                  <button type="button" className="evr" onClick={() => setOpen(isOpen ? null : e.key)} aria-expanded={isOpen}>
                    <span className={e.tone === "bad" ? "st s-bad" : "st s-ok"}>
                      {e.tone === "ok" ? (
                        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "12px", height: "12px" }}>
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : (
                        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "12px", height: "12px" }}>
                          <path d="M12 8v4" />
                          <path d="M12 16h.01" />
                        </svg>
                      )}
                    </span>
                    <span className="mono meta" style={{ width: "40px" }}>
                      {timeOf.format(new Date(e.at))}
                    </span>
                    <span className="ag">{e.agent}</span>
                    <span style={{ flex: "1 1 auto", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.what}</span>
                    <span className="mono meta" style={{ minWidth: "52px", textAlign: "right" }}>
                      {e.cost}
                    </span>
                  </button>
                  {isOpen ? (
                    <>
                      {e.who === null ? (
                        <div className="ledger">
                          <div>
                            <div className="meta">Held</div>
                            <div className="mono" style={{ fontSize: "13px" }}>{e.held}</div>
                          </div>
                          <div>
                            <div className="meta">Spent</div>
                            <div className="mono" style={{ fontSize: "13px" }}>{e.spent}</div>
                          </div>
                          <div>
                            <div className="meta">Back to you</div>
                            <div className="mono" style={{ fontSize: "13px" }}>{e.back}</div>
                          </div>
                        </div>
                      ) : null}
                      <div className="steps">
                        <div className="step">
                          <span className="t mono">{timeOf.format(new Date(e.at))}</span>
                          <span>{e.what}</span>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>,
    document.body,
  );
}
