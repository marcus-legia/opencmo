"use client";

import { useEffect, useState } from "react";

import type { Logs } from "@/app/api/v1/logs/route";
import { api, jsonBody } from "@/components/clipping/api";
import { SalesSettings } from "@/components/screens/sales/SalesSettings";
import { useScreen } from "@/components/screens/useScreen";
import { salesScanCard } from "@/lib/cmo/jobs/price-card";
import type { SalesScreen } from "@/lib/screens/sales";

import { useWorkspace } from "./workspace";

type Thread = SalesScreen["threads"][number];
type Tab = "threads" | "runs" | "settings";

const DISMISS_REASONS = ["Not our customer", "Already solved", "Too old", "Wrong community"] as const;

/** The artboard scores out of ten (8.4); Sales scores out of a hundred. */
const tenth = (score: number) => (score / 10).toFixed(1);
const tone = (score: number) => (score >= 75 ? "score hi" : score >= 60 ? "score mid" : "score lo");

function ago(iso: string | null): string {
  if (!iso) return "";
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

const runTime = (iso: string) => {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return d.toDateString() === new Date().toDateString() ? `Today ${time}` : `${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d)} ${time}`;
};

/** Scan now: the same price card as a scan asked in the CMO chat; nothing is held until the founder approves it. */
function ScanNow() {
  const card = salesScanCard();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "started">("idle");
  const [claude, setClaude] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    try {
      const mode = (await api("/cmo/mode")) as { brain?: string };
      setClaude(mode.brain === "claude");
      setStep("confirm");
    } catch {
      setError("Could not check where your scan would run. Try again in a moment.");
    }
  }
  async function start() {
    setStep("busy");
    setError(null);
    try {
      await api("/cmo/runs", jsonBody({ kind: "sales_scan" }));
      setStep("started");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scan. Please try again.");
      setStep("confirm");
    }
  }

  if (step === "started") {
    return <span className="chip">{claude ? "Sent to your Claude inbox" : "Scanning: threads land here within a few minutes"}</span>;
  }
  if (step === "idle") {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
        <button type="button" className="primary" onClick={() => void open()}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Scan now · {card.credits} credits
        </button>
        {error ? <span className="meta">{error}</span> : null}
      </span>
    );
  }
  return (
    <div className="card" role="group" aria-labelledby="scan-now-title" style={{ maxWidth: "360px" }}>
      <h2 id="scan-now-title" style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: "600" }}>
        {claude ? "Scan now · in your Claude, no OpenCMO credits" : `Scan now · ${card.credits} credits`}
      </h2>
      <ul style={{ margin: "0 0 10px", paddingLeft: "18px", fontSize: "13.5px", color: "var(--muted)" }}>
        {card.changes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {error ? <div className="meta">{error}</div> : null}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="skip" disabled={step === "busy"} onClick={() => setStep("idle")}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={step === "busy"} onClick={() => void start()}>
          {step === "busy" ? "Starting…" : claude ? "Send to my Claude" : `Approve and spend ${card.credits} credits`}
        </button>
      </div>
    </div>
  );
}

function ThreadRow({ t, open, onToggle, onDecide }: { t: Thread; open: boolean; onToggle: () => void; onDecide: (t: Thread, action: "replied" | "dismissed", reason?: string) => Promise<void> }) {
  const [draft, setDraft] = useState(t.draft ?? "");
  const [copied, setCopied] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const skipped = t.rule.kind === "skipped";
  const done = t.status !== "open";

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      // The thread still opens; the founder can select the draft and copy it by hand.
    }
    window.open(t.url, "_blank", "noopener,noreferrer");
  }
  async function run(action: "replied" | "dismissed", why?: string) {
    setBusy(true);
    await onDecide(t, action, why);
    setBusy(false);
  }

  return (
    <div className="th" data-open={open} role="listitem">
      <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
        <span className={tone(t.score)}>{tenth(t.score)}</span>
        <span style={{ flex: "1 1 auto", minWidth: "0" }}>
          <span style={{ display: "block", fontSize: "14.5px", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: done ? "var(--muted)" : undefined }}>{t.title}</span>
          <span className="meta">
            {[t.community, t.postedAt ? ago(t.postedAt) : null, t.comments != null ? `${t.comments} comments` : null, done ? (t.status === "replied" ? "you replied" : "dismissed") : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--subtle)" }}>
          <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open ? (
        <div style={{ borderTop: "1px solid var(--line)", padding: "14px 14px 14px 60px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {t.quotes.length ? (
            <div>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Why it scored {tenth(t.score)}
              </div>
              {t.quotes.map((q) => (
                <p key={q.text} className="quote" style={{ marginBottom: "6px" }}>
                  “{q.text}” <span className="meta">· {q.from}</span>
                </p>
              ))}
            </div>
          ) : null}
          <div className="meta">{t.rule.text}</div>
          {skipped ? (
            <div className="meta">Sales did not draft a reply. The community&apos;s rules leave no room for one.</div>
          ) : t.draft === null ? (
            <div className="meta">No draft yet. Sales drafts replies for the highest-scored threads first.</div>
          ) : (
            <div>
              <label className="meta" htmlFor={`reply-${t.id}`} style={{ display: "block", marginBottom: "6px" }}>
                Draft reply
              </label>
              <textarea id={`reply-${t.id}`} className="reply" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={done} rows={4} style={{ width: "100%", resize: "vertical", font: "inherit", fontSize: "15px", lineHeight: "1.55", color: "var(--text)" }} />
              {t.draftChecks ? (
                <div className="meta" style={{ marginTop: "6px" }}>
                  {t.draftChecks}
                </div>
              ) : null}
            </div>
          )}
          {done ? (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="ghost" style={{ textDecoration: "none" }}>
                Open thread
              </a>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              {dismissing ? (
                <>
                  <label className="meta" htmlFor={`why-${t.id}`}>
                    Reason
                  </label>
                  <select id={`why-${t.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="pill" style={{ height: "32px" }}>
                    {DISMISS_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button type="button" className="ghost" disabled={busy} onClick={() => void run("dismissed", reason)}>
                    Dismiss
                  </button>
                </>
              ) : (
                <button type="button" className="skip" onClick={() => setDismissing(true)}>
                  Dismiss
                </button>
              )}
              {skipped ? null : (
                <button type="button" className="ghost" disabled={busy} onClick={() => void run("replied")}>
                  Mark replied
                </button>
              )}
              {!skipped && t.draft !== null ? (
                <button type="button" className="primary" disabled={!draft.trim()} onClick={() => void copyAndOpen()}>
                  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                    <rect width="14" height="14" x="8" y="8" rx="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  {copied ? "Copied · thread opened" : "Copy and open thread"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Sales agent page (AgentSales.dc.html). Sales drafts replies; the founder posts them on their own account. There is
 * no post button here, ever (CLAUDE.md, "Assist, never act"): Copy and open thread puts the draft on the clipboard and
 * opens the thread.
 */
export function AgentSales() {
  const [state] = useScreen("sales");
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("threads");
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [week, setWeek] = useState<SalesScreen["week"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ id: string; at: string; text: string }[]>([]);
  const data = state.status === "ready" ? state.data : null;
  const live = state.status === "ready" && Boolean(state.live.threads);

  useEffect(() => {
    if (!data) return;
    setThreads([...data.threads].sort((a, b) => b.score - a.score));
    setWeek(data.week);
    setOpen((was) => was ?? data.threads.find((t) => t.status === "open")?.id ?? null);
  }, [data]);

  useEffect(() => {
    void api<Logs>("/logs")
      .then((logs) => setRuns(logs.events.filter((e) => e.who === "sales").slice(0, 5)))
      .catch(() => {});
  }, []);

  async function decide(t: Thread, action: "replied" | "dismissed", reason?: string) {
    setError(null);
    try {
      // Sample threads change only in the browser; live ones go through the ownership-checking RPC.
      if (live) await api(`/cmo/opportunities/${encodeURIComponent(t.id)}`, jsonBody({ action, reason }));
      setThreads((all) => (all ?? []).map((x) => (x.id === t.id ? { ...x, status: action } : x)));
      setWeek((w) => (w ? (action === "replied" ? { ...w, replied: w.replied + 1 } : { ...w, dismissed: w.dismissed + 1 }) : w));
      setOpen((threads ?? []).find((x) => x.id !== t.id && x.status === "open")?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that. Please try again.");
    }
  }

  const list = threads ?? [];
  const worth = list.filter((t) => t.status === "open" && t.rule.kind !== "skipped");
  const below = list.length - worth.length;
  const lastScan = runs[0]?.at ?? null;
  const name = ws.name ?? "your product";

  // The banner's way to the settings: the tab, then the cursor on its heading, so the founder lands where to act.
  const openSettings = () => {
    setTab("settings");
    requestAnimationFrame(() => document.getElementById("sales-settings-title")?.focus());
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", maxWidth: "1320px", margin: "0 auto", padding: "22px 24px 40px", gap: "24px" }} data-testid="v2-sales">
      <main style={{ flex: "999 1 600px", minWidth: "0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", flexWrap: "wrap" }}>
          <span className="tile">
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "20px", height: "20px" }}>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
          </span>
          <div style={{ flex: "1 1 300px", minWidth: "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>Sales</h1>
              {lastScan ? (
                <span className="chip">
                  <span className="live"></span>Scanned {ago(lastScan)} ago
                </span>
              ) : null}
            </div>
            <p style={{ margin: "4px 0 8px", color: "var(--muted)", fontSize: "14px", maxWidth: "620px" }}>
              Finds public conversations where people describe the problem {name} solves, scores each one with the exact words, and drafts a help-first reply. You post it yourself; Sales has no post button.
            </p>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              <span className="meta">Reads</span>
              <span className="chip">Product</span>
              <span className="chip">Competitors</span>
              <span className="chip">Brand voice</span>
            </div>
          </div>
          <ScanNow />
        </div>

        <div className="tabs" role="tablist" aria-label="Sales">
          {(
            [
              ["threads", "Threads"],
              ["runs", "Runs"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, labelText]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {labelText}
            </button>
          ))}
        </div>

        {state.status === "loading" ? <div className="meta" style={{ marginTop: "14px" }}>Loading…</div> : null}
        {state.status === "error" ? <div className="meta" style={{ marginTop: "14px" }}>{state.message}</div> : null}
        {error ? <div className="meta" style={{ marginTop: "14px", color: "var(--warn)" }}>{error}</div> : null}
        {data?.stuck ? (
          <div className="card" role="alert" style={{ marginTop: "14px" }}>
            <b>{data.stuck.text}</b>{" "}
            <button type="button" className="ghost" onClick={openSettings} style={{ marginLeft: "8px" }}>
              Change where Sales looks
            </button>
          </div>
        ) : null}

        {tab === "threads" && data ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0 10px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: "600" }}>
                {worth.length} {worth.length === 1 ? "thread" : "threads"} worth a reply
              </span>
              <span className="meta">
                · {list.length} checked, {below} below your bar or done
              </span>
              <div style={{ flex: "1 1 auto" }}></div>
              <span className="meta">Sort</span>
              <span className="pill">Score</span>
            </div>
            {list.length === 0 ? <div className="meta">No threads yet. Sales scans the communities your customers use and scores what it finds.</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} role={list.length ? "list" : undefined} aria-label={list.length ? "Threads" : undefined}>
              {list.map((t) => (
                <ThreadRow key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onDecide={decide} />
              ))}
            </div>
          </>
        ) : null}

        {tab === "runs" ? (
          <section className="card" style={{ marginTop: "14px" }}>
            {runs.length === 0 ? <div className="meta">No scans yet.</div> : null}
            {runs.map((r) => (
              <div key={r.id} className="run">
                <span className="meta" style={{ width: "96px" }}>
                  {runTime(r.at)}
                </span>
                <span style={{ flex: "1" }}>{r.text}</span>
              </div>
            ))}
          </section>
        ) : null}

        {tab === "settings" && data ? (
          <div className="v2" style={{ marginTop: "14px" }}>
            <SalesSettings initial={data.settings} live={Boolean(state.status === "ready" && state.live.settings)} />
          </div>
        ) : null}
      </main>

      <aside style={{ flex: "1 1 300px", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
            <h2 style={{ margin: "0", fontSize: "14px", fontWeight: "600" }}>This week</h2>
            <span className="meta">since Mon</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "8px" }}>
            <div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{week?.replied ?? "–"}</div>
              <div className="meta">replied</div>
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{week?.dismissed ?? "–"}</div>
              <div className="meta">dismissed</div>
            </div>
            <div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{data ? `${data.mentions.used}/${data.mentions.window}` : "–"}</div>
              <div className="meta">named the product</div>
            </div>
          </div>
        </section>
        <section className="card">
          <h2 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: "600" }}>Recent runs</h2>
          {runs.length === 0 ? <div className="meta">No scans yet.</div> : null}
          {runs.slice(0, 3).map((r) => (
            <div key={r.id} className="run">
              <span className="meta" style={{ width: "64px" }}>
                {runTime(r.at)}
              </span>
              <span style={{ flex: "1" }}>{r.text}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <h2 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: "600" }}>Where it looks</h2>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
            <span>Reddit</span>
            <span className="meta">{data?.settings.excludedSubreddits.length ? `all but ${data.settings.excludedSubreddits.length} excluded` : "on"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
            <span>Hacker News</span>
            <span className="meta">on</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 0", marginTop: "6px", borderTop: "1px solid var(--line)" }}>
            <span>Term pairs</span>
            <button type="button" className="pill" onClick={() => setTab("settings")}>
              {data?.settings.pairs.length ?? 0} set
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
