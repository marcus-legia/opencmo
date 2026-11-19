"use client";

import { STRONG_MATCH, matchLabel } from "@/lib/cmo/match";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Logs } from "@/app/api/v1/logs/route";
import { PlanSheet, isPlanRequired } from "@/components/billing/PlanSheet";
import { api, jsonBody } from "@/components/clipping/api";
import { useLive } from "@/components/clipping/useLive";
import { useScreen } from "@/components/screens/useScreen";
import { useOptionalShellState } from "@/components/shell-v2/ShellState";
import { salesScanCard } from "@/lib/cmo/jobs/price-card";
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";
import type { SalesScreen } from "@/lib/screens/sales";
import { createClient } from "@/lib/supabase/client";

import { useWorkspace } from "./workspace";

// Reaching out, Following up and the settings tab open after the list: their code loads when first shown, which keeps
// the Sales page inside its first-load budget (scripts/bundle-budget.mts, review of #239).
const ReachPanel = dynamic(() => import("./SalesReach").then((m) => m.ReachPanel), { loading: () => <div className="meta">Loading…</div> });
const ReplyLink = dynamic(() => import("./SalesReach").then((m) => m.ReplyLink));
const FollowingUp = dynamic(() => import("./SalesReach").then((m) => m.FollowingUp), { loading: () => <div className="meta">Loading…</div> });
const SalesSettings = dynamic(() => import("@/components/screens/sales/SalesSettings").then((m) => m.SalesSettings), { loading: () => <div className="meta">Loading…</div> });

type Thread = SalesScreen["threads"][number];
type Tab = "threads" | "following" | "runs" | "settings";

const DISMISS_REASONS = ["Not our customer", "Already solved", "Too old", "Wrong community"] as const;

/** A word reads faster than a number (owner, 2026-11-19); the number stays in "how it was counted". */
const tone = (score: number) => (score >= STRONG_MATCH ? "score hi" : score >= 60 ? "score mid" : "score lo");

function ago(iso: string | null): string {
  if (!iso) return "";
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return h < 1 ? "just now" : h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

const runTime = (iso: string) => {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return d.toDateString() === new Date().toDateString() ? `Today ${time}` : `${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(d)} ${time}`;
};

type ScanStep = { label: string; status: "running" | "done" | "failed" };
/** A run the page follows: a scan, or the replies written after paying (`sales_reply_drafts`). */
type RunKind = "sales_scan" | "sales_reply_drafts";
type Scan = { id: string; kind: RunKind; status: "queued" | "running" | "done" | "failed"; steps: ScanStep[]; error: string | null; cards: number | null; since: string };

const SCAN_COLUMNS = "id, kind, status, steps, error, output, created_at, started_at";
const RUN_KINDS: RunKind[] = ["sales_scan", "sales_reply_drafts"];
const scanActive = (scan: Scan | null): scan is Scan => scan !== null && (scan.status === "queued" || scan.status === "running");

/**
 * A `cmo_runs` row as the progress card shows it. The step labels are fixed text from `sales-scan.ts` (with counts the
 * job filled in), written by the runner before and after each step, so the card follows the scan as it goes.
 */
function toScan(row: Record<string, unknown>): Scan {
  const status = row.status === "queued" || row.status === "running" || row.status === "done" || row.status === "failed" ? row.status : "queued";
  const steps = (Array.isArray(row.steps) ? row.steps : []).flatMap((s): ScanStep[] => {
    const step = s as { label?: unknown; status?: unknown };
    if (typeof step.label !== "string") return [];
    return [{ label: step.label.slice(0, 160), status: step.status === "done" || step.status === "failed" ? step.status : "running" }];
  });
  const output = row.output as { cards?: unknown; drafted?: unknown } | null;
  const kind: RunKind = row.kind === "sales_reply_drafts" ? "sales_reply_drafts" : "sales_scan";
  const count = kind === "sales_reply_drafts" ? output?.drafted : output?.cards;
  return {
    id: String(row.id),
    kind,
    status,
    steps,
    error: typeof row.error === "string" ? row.error : null,
    cards: typeof count === "number" ? count : null,
    since: String(row.started_at ?? row.created_at ?? new Date().toISOString()),
  };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** What the scan is doing right now, step by step; a finished scan says what it found until the founder closes it. */
function ScanProgress({ scan, onClose }: { scan: Scan; onClose: () => void }) {
  const active = scanActive(scan);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const replies = scan.kind === "sales_reply_drafts";
  const title =
    scan.status === "queued"
      ? replies
        ? "Starting on the replies…"
        : "Scan starting…"
      : scan.status === "running"
        ? `${replies ? "Writing the replies" : "Scanning"} · ${clock(now - Date.parse(scan.since))}`
        : scan.status === "failed"
          ? replies
            ? "The replies did not finish"
            : "The scan did not finish"
          : replies
            ? scan.cards
              ? `Replies written · ${scan.cards} to read`
              : "Replies written"
            : scan.cards
              ? `Scan finished · ${scan.cards} ${scan.cards === 1 ? "thread" : "threads"} to review`
              : "Scan finished · nothing worth joining this time";

  return (
    <section className="card" role="status" aria-live="polite" style={{ marginTop: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {active ? <span className="live"></span> : null}
        <b style={{ flex: "1 1 auto" }}>{title}</b>
        {active ? null : (
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {scan.status === "queued" && !scan.steps.length ? <div className="meta" style={{ marginTop: "6px" }}>Waiting for a free worker. This usually takes a few seconds.</div> : null}
      {scan.steps.length ? (
        <ol style={{ listStyle: "none", margin: "10px 0 0", padding: "0", display: "flex", flexDirection: "column", gap: "6px" }}>
          {scan.steps.map((step, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", color: step.status === "running" ? "var(--text)" : "var(--muted)" }}>
              <span aria-hidden="true" style={{ width: "14px", display: "inline-flex", justifyContent: "center" }}>
                {step.status === "running" ? (
                  <span className="live"></span>
                ) : step.status === "done" ? (
                  <svg className="i s" viewBox="0 0 24 24" style={{ color: "var(--ok)" }}>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg className="i s" viewBox="0 0 24 24" style={{ color: "var(--warn)" }}>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                )}
              </span>
              <span>
                {step.label}
                <span className="sr-only">{step.status === "running" ? " (in progress)" : step.status === "failed" ? " (failed)" : " (done)"}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {scan.status === "failed" && scan.error ? <div className="meta" style={{ marginTop: "8px", color: "var(--warn)" }}>{scan.error}</div> : null}
    </section>
  );
}

/**
 * Scan now: the same card as a scan asked in the CMO chat, with no price (included in the plan's fair use, wave 2);
 * nothing runs until the founder approves it. An
 * unpaid account's first scan is free (`cmo_first_run_free`); after it, the button opens the plan sheet instead of
 * answering with the 402's text.
 */
function ScanNow({ scanning, paused, platforms, free, freeLeft, onPlan, onStarted }: { scanning: boolean; paused: boolean; platforms?: SalesPlatform[]; free: boolean; freeLeft: boolean; onPlan: (action: string) => void; onStarted: (run: { id: string; status: string; created_at: string }) => void }) {
  // The card names the places the founder's switches leave on: the scan searches those only.
  const card = salesScanCard(undefined, platforms);
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    if (free && !freeLeft) onPlan("scan again");
    else setStep("confirm");
  }
  async function start() {
    setStep("busy");
    setError(null);
    try {
      // A scan already in flight comes back as itself (`cmo_enqueue`), so a second press follows the same run.
      onStarted(await api<{ id: string; status: string; created_at: string }>("/cmo/runs", jsonBody({ kind: "sales_scan" })));
      setStep("idle");
    } catch (err) {
      if (isPlanRequired(err)) {
        setStep("idle");
        onPlan("scan again");
        return;
      }
      setError(err instanceof Error ? err.message : "Could not start the scan. Please try again.");
      setStep("confirm");
    }
  }

  if (scanning) {
    return (
      <span className="chip">
        <span className="live"></span>Scanning…
      </span>
    );
  }
  if (step === "idle") {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
        <button type="button" className="primary" onClick={open} disabled={paused} title={paused ? "New scans wait for the allowance to reset" : undefined}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          {freeLeft ? "Scan now · free" : "Scan now"}
        </button>
        {error ? <span className="meta">{error}</span> : null}
      </span>
    );
  }
  return (
    <div className="card" role="group" aria-labelledby="scan-now-title" style={{ maxWidth: "360px" }}>
      <h2 id="scan-now-title" style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: "600" }}>
        {freeLeft ? "Your free scan" : "Scan now"}
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
          {step === "busy" ? "Starting…" : freeLeft ? "Start the free scan" : "Start the scan"}
        </button>
      </div>
    </div>
  );
}

/**
 * Write the replies: after paying, one click drafts the threads the free scan found (`sales_reply_drafts`, included in
 * the plan since wave 2); nothing runs until the founder approves it, as with a scan.
 */
function WriteReplies({ count, busy, onPlan, onStarted }: { count: number; busy: boolean; onPlan: (action: string) => void; onStarted: (run: { id: string; status: string; created_at: string }) => void }) {
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStep("busy");
    setError(null);
    try {
      onStarted(await api<{ id: string; status: string; created_at: string }>("/cmo/runs", jsonBody({ kind: "sales_reply_drafts" })));
      setStep("idle");
    } catch (err) {
      if (isPlanRequired(err)) {
        setStep("idle");
        onPlan("reply to these people");
        return;
      }
      setError(err instanceof Error ? err.message : "Could not start the replies. Please try again.");
      setStep("confirm");
    }
  }

  return (
    <div className="card" role="group" aria-labelledby="write-replies-title" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
      <div style={{ flex: "1 1 260px", minWidth: "0" }}>
        <b id="write-replies-title">
          {count} {count === 1 ? "thread has" : "threads have"} no reply yet
        </b>
        <div className="meta">Sales writes a help-first reply for each, under each community&apos;s rules. You post them yourself.</div>
        {error ? (
          <div className="meta" role="alert" style={{ color: "var(--warn)", marginTop: "4px" }}>
            {error}
          </div>
        ) : null}
      </div>
      {busy ? (
        <span className="chip">
          <span className="live"></span>Writing…
        </span>
      ) : step === "idle" ? (
        <button type="button" className="primary" onClick={() => setStep("confirm")}>
          Write the replies
        </button>
      ) : (
        <span style={{ display: "inline-flex", gap: "8px" }}>
          <button type="button" className="skip" disabled={step === "busy"} onClick={() => setStep("idle")}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={step === "busy"} onClick={() => void start()}>
            {step === "busy" ? "Starting…" : "Write them"}
          </button>
        </span>
      )}
    </div>
  );
}

/** "Reddit, Hacker News and Threads". */
function places(list: SalesPlatform[]): string {
  const names = list.map((p) => PLATFORM_LABEL[p]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/**
 * The scan's verdict when it found no one (free-scan plan B3): a plain answer about the product's fit, with what it
 * searched and where, so the founder can judge the search. Not an error and not a paywall push.
 */
/**
 * Wave 3 (canvas "Scan problems"): what Sales says while a paid account's first scan runs, and when a scan could not do
 * its work. Each says what happened and the one thing the founder can do; none promises anything we do not check.
 */
function WhileYouWait() {
  return (
    <section className="card" data-testid="sales-while-you-wait" style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <b>Your first scan is running. It takes a few minutes.</b>
      <div className="meta">While you wait:</div>
      <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "14px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <li>
          <a href="/app/business?d=brand">Paste a few things you wrote</a>: replies and posts follow how you write.
        </li>
        <li>
          <a href="/app/settings#settings-connected-accounts">Connect X or LinkedIn</a> to schedule the posts you approve.
        </li>
        <li>
          <a href="/app/settings#settings-tracking">Get your tracking links</a>, so sign-ups from your replies can be counted.
        </li>
      </ul>
    </section>
  );
}

function ScanProblem({ testId, title, detail, action }: { testId: string; title: string; detail: string; action?: { label: string; href?: string; onClick?: () => void } }) {
  return (
    <div className="card" role="status" data-testid={testId} style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: "0" }}>
        <b>{title}</b>
        <div className="meta">{detail}</div>
      </div>
      {action?.href ? (
        <a href={action.href} className="ghost" style={{ textDecoration: "none" }}>
          {action.label}
        </a>
      ) : action?.onClick ? (
        <button type="button" className="ghost" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function NoOneAsked({ scan, onEdit }: { scan: NonNullable<SalesScreen["lastScan"]>; onEdit: () => void }) {
  const answered = scan.platforms.filter((p) => !scan.failed.includes(p));
  return (
    <section className="card" data-testid="sales-none" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
      <h2 style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>No one asked about this in the last 30 days.</h2>
      {scan.queries.length ? (
        <div>
          <div className="meta" style={{ marginBottom: "6px" }}>
            We searched for:
          </div>
          <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
            {scan.queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="meta">
        {answered.length ? `Looked on ${places(answered)}` : "No place answered"}
        {scan.scanned ? `, ${scan.scanned} ${scan.scanned === 1 ? "conversation" : "conversations"} read` : ""}.
        {scan.failed.length ? ` ${places(scan.failed)} did not answer.` : ""}
      </div>
      <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)" }}>
        Sales searched with the words it took from your website. If your customers describe the problem differently, tell it what to look for.
      </p>
      <div>
        <button type="button" className="ghost" onClick={onEdit}>
          Edit what Sales looks for
        </button>
      </div>
    </section>
  );
}

function ThreadRow({ t, free, open, onToggle, onPlan, onDecide, onSent }: { t: Thread; free: boolean; open: boolean; onToggle: () => void; onPlan: (action: string) => void; onDecide: (t: Thread, action: "replied" | "dismissed", reason?: string, text?: string) => Promise<void>; onSent: (t: Thread, via: "dm" | "email") => Promise<void> }) {
  const [draft, setDraft] = useState(t.draft ?? "");
  const [copied, setCopied] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const skipped = t.rule.kind === "skipped";
  const done = t.status !== "open";
  // Free: the reply is written (or shown) once the founder picks a plan. Until then the thread is still worth reading.
  const locked = free && !skipped && t.draft === null;
  const lead = t.quotes[0] ?? null;

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
    // The reply that counts is the one the founder posted: an edited draft goes with "replied", so the 1-in-10 mention
    // rule and the learning read what went out, not the draft.
    const posted = draft.trim();
    await onDecide(t, action, why, action === "replied" && posted && posted !== (t.draft ?? "").trim() ? posted.slice(0, 3000) : undefined);
    setBusy(false);
  }

  return (
    <div className="th" data-open={open} role="listitem">
      <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
        <span className={tone(t.score)}>{matchLabel(t.score)}</span>
        <span style={{ flex: "1 1 auto", minWidth: "0" }}>
          <span style={{ display: "block", fontSize: "14.5px", fontWeight: "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: done ? "var(--muted)" : undefined }}>{t.title}</span>
          <span className="meta">
            {[PLATFORM_LABEL[t.platform], t.community !== PLATFORM_LABEL[t.platform] ? t.community : null, t.postedAt ? ago(t.postedAt) : null, t.comments != null ? `${t.comments} comments` : null, done ? (t.status === "replied" ? "you replied" : "dismissed") : null].filter(Boolean).join(" · ")}
          </span>
          {lead && !open && !done ? (
            <span className="quote" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: "6px", fontSize: "13.5px" }}>
              “{lead.text}”
            </span>
          ) : null}
        </span>
        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--subtle)" }}>
          <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open ? (
        <div className="th-body">
          {t.quotes.length ? (
            <div>
              <div className="meta" style={{ marginBottom: "6px" }}>
                {matchLabel(t.score)} ({t.score}/100): how it was counted
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
          ) : locked ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }} data-testid="sales-reply-locked">
              <span className="meta" style={{ flex: "1 1 220px" }}>
                {t.drafted ? "Your reply is written. You see it once you pick a plan." : "Your reply is written once you pick a plan."}
              </span>
              <button type="button" className="primary" onClick={() => onPlan("reply to these people")}>
                Pick a plan
              </button>
            </div>
          ) : t.draft === null ? (
            <div className="meta">No reply yet. Write the replies above, or reply in your own words and mark it replied.</div>
          ) : !done && t.person ? (
            <ReachPanel
              t={t}
              onSent={(via) => onSent(t, via)}
              publicReply={
                <div>
                  <label className="meta" htmlFor={`reply-${t.id}`} style={{ display: "block", marginBottom: "6px" }}>
                    Draft reply
                  </label>
                  <textarea id={`reply-${t.id}`} className="reply" value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} style={{ width: "100%", resize: "vertical", font: "inherit", fontSize: "15px", lineHeight: "1.55", color: "var(--text)" }} />
                  {t.draftChecks ? (
                    <div className="meta" style={{ marginTop: "6px" }}>
                      {t.draftChecks}
                    </div>
                  ) : null}
                </div>
              }
            />
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
              {skipped ? null : locked ? (
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="ghost" style={{ textDecoration: "none" }}>
                  Open thread
                </a>
              ) : (
                <button type="button" className="ghost" disabled={busy} onClick={() => void run("replied")}>
                  I replied
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
  const [state, reload] = useScreen("sales");
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("threads");
  // Today's "Open Following up" links to `?tab=following`: the tab named in the link opens first.
  useEffect(() => {
    const named = new URLSearchParams(window.location.search).get("tab");
    if (named === "threads" || named === "following" || named === "runs" || named === "settings") setTab(named);
  }, []);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [week, setWeek] = useState<SalesScreen["week"] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ id: string; at: string; text: string }[]>([]);
  const data = state.status === "ready" ? state.data : null;
  const live = state.status === "ready" && Boolean(state.live.threads);
  const free = data?.free ?? false;
  // The plan sheet, titled with what the founder tried ("reply to these people", "scan again").
  const [planFor, setPlanFor] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setThreads([...data.threads].sort((a, b) => b.score - a.score));
    setWeek(data.week);
    setOpen((was) => was ?? data.threads.find((t) => t.status === "open")?.id ?? null);
  }, [data]);

  const loadRuns = useCallback(() => {
    void api<Logs>("/logs")
      .then((logs) => setRuns(logs.events.filter((e) => e.who === "sales").slice(0, 5)))
      .catch(() => {});
  }, []);
  useEffect(loadRuns, [loadRuns]);

  // Wave 3 "Scan problems", read once: the newest scan (a failed one is not followed live) and whether Sales has a
  // Strategy to know who to look for.
  const [lastRun, setLastRun] = useState<{ status: string; error: string | null; at: string } | null>(null);
  const [noStrategy, setNoStrategy] = useState(false);
  useEffect(() => {
    const db = createClient();
    void db.from("cmo_runs").select("status, error, created_at").eq("kind", "sales_scan").order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const row = data as { status: string; error: string | null; created_at: string } | null;
        if (row) setLastRun({ status: row.status, error: row.error, at: row.created_at });
      });
    void db.from("marketing_documents_latest").select("kind").eq("kind", "strategy").limit(1)
      .then(({ data, error }) => {
        if (!error && (data ?? []).length === 0) setNoStrategy(true);
      });
  }, []);

  // The scan being followed. Realtime (with useLive's 5-second fallback poll) re-reads it under RLS; the payload is never
  // trusted. When it finishes, the threads and the runs are read again, so new threads show without a page reload.
  const [scan, setScan] = useState<Scan | null>(null);
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const refreshScan = useCallback(async (id?: string) => {
    const was = scanRef.current;
    const target = id ?? (scanActive(was) ? was.id : null);
    if (!target) return;
    const { data } = await createClient().from("cmo_runs").select(SCAN_COLUMNS).eq("id", target).maybeSingle();
    if (!data) return;
    const next = toScan(data as Record<string, unknown>);
    setScan((current) => (current === null || current.id === next.id ? next : current));
    if (!scanActive(next)) {
      reload();
      loadRuns();
    }
  }, [reload, loadRuns]);
  useLive("cmo_runs", scanActive(scan) ? `id=eq.${scan.id}` : null, () => void refreshScan(), scanActive(scan), true, "sales");

  // A scan started elsewhere (the chat, the daily loop) or before a reload is followed too.
  useEffect(() => {
    void createClient()
      .from("cmo_runs")
      .select(SCAN_COLUMNS)
      .in("kind", RUN_KINDS)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setScan((current) => current ?? toScan(data as Record<string, unknown>));
      });
  }, []);

  const startedScan = useCallback(
    (run: { id: string; status: string; created_at: string }) => {
      setScan((current) => (current?.id === run.id ? current : toScan({ ...run, steps: [] })));
      // The run may already be under way (a second press): read its steps now rather than at the next event.
      void refreshScan(run.id);
    },
    [refreshScan],
  );

  // "I replied" then asks where (canvas board Replied); "I sent it" on a DM or an email does not: there is no link.
  const [askLink, setAskLink] = useState<Thread | null>(null);
  const setPerson = (id: string, change: Partial<NonNullable<Thread["person"]>>) =>
    setThreads((all) => (all ?? []).map((x) => (x.id === id && x.person ? { ...x, person: { ...x.person, ...change } } : x)));

  async function decide(t: Thread, action: "replied" | "dismissed", reason?: string, text?: string, ask = true, via?: "dm" | "email") {
    setError(null);
    try {
      // Sample threads change only in the browser; live ones go through the ownership-checking RPC.
      // A DM or an email sent is its own action: SQL keeps it out of the public reply re-reads and nudges.
      if (live) await api(`/cmo/opportunities/${encodeURIComponent(t.id)}`, jsonBody(via ? { action: "sent", via } : action === "replied" ? { action, ...(text ? { text } : {}) } : { action, reason }));
      setThreads((all) =>
        (all ?? []).map((x) =>
          x.id === t.id
            ? {
                ...x,
                status: action,
                ...(text ? { draft: text } : {}),
                // SQL moves a person found to replied with the decision (the people_reach trigger).
                ...(action === "replied" && x.person && x.person.status === "found" ? { person: { ...x.person, status: "replied" as const, repliedAt: new Date().toISOString(), statusAt: new Date().toISOString() } } : {}),
              }
            : x,
        ),
      );
      if (action === "replied" && ask) setAskLink(t);
      setWeek((w) => (w ? (action === "replied" ? { ...w, replied: w.replied + 1 } : { ...w, dismissed: w.dismissed + 1 }) : w));
      setOpen((threads ?? []).find((x) => x.id !== t.id && x.status === "open")?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that. Please try again.");
    }
  }

  const list = threads ?? [];
  const following = list.filter((t) => t.status === "replied" && t.person && t.person.status !== "found" && t.person.status !== "not_interested").length;
  const worth = list.filter((t) => t.status === "open" && t.rule.kind !== "skipped");
  const below = list.length - worth.length;
  const lastScan = runs[0]?.at ?? null;
  // Paid, and threads the free scan found without a reply: one click writes them.
  const undrafted = free ? 0 : worth.filter((t) => !t.drafted).length;
  // The free scan is used once a scan finished (or one is under way); a failed one is given back by SQL. One that found
  // no one leaves one more (`cmo_first_run_free`, wave 2); if that one was the second, the 402 opens the plan sheet.
  const freeDone = data?.freeScansDone ?? 0;
  const freeLeft = free && !scanActive(scan) && (freeDone === 0 || (freeDone === 1 && data?.lastScan?.free === true && data.lastScan.verdict === "none"));
  const name = ws.name ?? "your product";
  // Fair use (wave 2): at 100% new scans wait for the reset; `cmo_enqueue` refuses them on its own as well.
  const usage = useOptionalShellState()?.usage;
  const paused = usage?.paused ? (usage.resetsAt ? new Date(usage.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "the next reset") : null;

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
          <ScanNow scanning={scanActive(scan) && scan.kind === "sales_scan"} paused={paused !== null} platforms={data?.settings.platforms} free={free} freeLeft={freeLeft} onPlan={setPlanFor} onStarted={startedScan} />
        </div>
        {scan ? <ScanProgress scan={scan} onClose={() => setScan(null)} /> : null}
        {data && !free && !data.lastScan && scanActive(scan) && scan.kind === "sales_scan" ? <WhileYouWait /> : null}
        {noStrategy ? (
          <ScanProblem
            testId="sales-not-set-up"
            title="Sales does not know who to look for yet"
            detail="It reads your Strategy: who your customers are and the problems they write about. Add your website or fill in the Strategy, then scan."
            action={{ label: "Open Your business", href: "/app/business?d=strategy" }}
          />
        ) : null}
        {!scanActive(scan) && lastRun?.status === "failed" && (!data?.lastScan || Date.parse(lastRun.at) > Date.parse(data.lastScan.at)) ? (
          <ScanProblem
            testId="sales-scan-failed"
            title="The last scan did not finish"
            detail={`${lastRun.error ?? "Something went wrong."} The people found before are still here. Scan again when you are ready.`}
          />
        ) : null}
        {!scanActive(scan) && data?.lastScan && data.lastScan.verdict !== "none" && data.lastScan.failed.length ? (
          <ScanProblem
            testId="sales-source-down"
            title={`${places(data.lastScan.failed)} did not answer in the last scan`}
            detail={`The other places were read. The next scan tries ${data.lastScan.failed.length === 1 ? "it" : "them"} again.`}
            action={{ label: "Where Sales looks", onClick: openSettings }}
          />
        ) : null}
        {paused ? (
          <div className="card" role="status" data-testid="sales-paused" style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: "0" }}>
              <b>You used this month&apos;s allowance</b>
              <div className="meta">
                New scans start again on {paused}. The people already found, your drafts and your posts keep working.
              </div>
            </div>
            <a href="/app/billing" className="ghost" style={{ textDecoration: "none" }}>
              Plan and billing
            </a>
          </div>
        ) : null}

        <div className="tabs" role="tablist" aria-label="Sales">
          {(
            [
              ["threads", "Threads"],
              ["following", "Following up"],
              ["runs", "Runs"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, labelText]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {labelText}
              {id === "following" && following > 0 ? ` · ${following}` : ""}
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

        {tab === "threads" && askLink ? (
          <div style={{ marginTop: "14px" }}>
            <ReplyLink
              t={askLink}
              live={Boolean(live)}
              onDone={(url) => {
                if (url) setPerson(askLink.id, { replyUrl: url });
                setAskLink(null);
              }}
            />
          </div>
        ) : null}
        {tab === "following" && data ? <FollowingUp threads={list} live={Boolean(live)} onStatus={(id, status) => setPerson(id, { status, statusAt: new Date().toISOString() })} /> : null}
        {tab === "threads" && data ? (
          <>
            <div style={{ display: list.length === 0 && data.lastScan?.verdict === "none" ? "none" : "flex", alignItems: "center", gap: "8px", margin: "14px 0 10px", flexWrap: "wrap" }}>
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
            {live && undrafted > 0 ? <WriteReplies count={undrafted} busy={scanActive(scan) && scan.kind === "sales_reply_drafts"} onPlan={setPlanFor} onStarted={startedScan} /> : null}
            {list.length === 0 && data.lastScan?.verdict === "none" ? <NoOneAsked scan={data.lastScan} onEdit={openSettings} /> : null}
            {list.length === 0 && data.lastScan?.verdict !== "none" ? <div className="meta">No threads yet. Sales scans the communities your customers use and scores what it finds.</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} role={list.length ? "list" : undefined} aria-label={list.length ? "Threads" : undefined}>
              {list.map((t) => (
                <ThreadRow key={t.id} t={t} free={free} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onPlan={setPlanFor} onDecide={decide} onSent={(x, via) => decide(x, "replied", undefined, undefined, false, via)} />
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
            <SalesSettings initial={data.settings} live={Boolean(state.status === "ready" && state.live.settings)} onSaved={reload} />
          </div>
        ) : null}
      </main>

      <aside style={{ flex: "1 1 300px", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
            {/* The funnel ("This week") is the Context column's; this box is the replies and the 1-in-10 mention rule. */}
            <h2 style={{ margin: "0", fontSize: "14px", fontWeight: "600" }}>Your replies</h2>
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
          {SALES_PLATFORMS.map((p) => {
            const on = (data?.settings.platforms ?? SALES_PLATFORMS).includes(p);
            const excluded = data?.settings.excludedSubreddits.length ?? 0;
            return (
              <div key={p} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                <span>{PLATFORM_LABEL[p]}</span>
                <span className="meta">{!on ? "off" : p === "reddit" && excluded ? `all but ${excluded} excluded` : "on"}</span>
              </div>
            );
          })}
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
      <PlanSheet open={planFor !== null} onClose={() => setPlanFor(null)} action={planFor ?? undefined} />
    </div>
  );
}
