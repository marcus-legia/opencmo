"use client";

import { OWN_ENOUGH, ownShare } from "@/lib/cmo/idea";
import { STRONG_MATCH, matchLabel } from "@/lib/cmo/match";
import { oldDays, ruleHeadline } from "@/lib/cmo/sales-card";
import { bare, isTheirWords } from "@/lib/cmo/quote";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Logs } from "@/app/api/v1/logs/route";
import { PlanSheet, isPlanRequired } from "@/components/billing/PlanSheet";
import { AllowanceBanner, useUsageState } from "@/components/billing/UsageNotice";
import { api, jsonBody } from "@/components/clipping/api";
import { useLive } from "@/components/clipping/useLive";
import { useScreen } from "@/components/screens/useScreen";
import { useOptionalShellState } from "@/components/shell-v2/ShellState";
import { salesScanCard } from "@/lib/cmo/jobs/price-card";
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";
import type { SalesScreen } from "@/lib/screens/sales";
import { createClient } from "@/lib/supabase/client";

import { IdeaDraft } from "./IdeaDraft";
import { usePhone } from "./phone";
import { hasLogo, PlatformBadge } from "./platform-logos";
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
              ? `Reply ideas written · ${scan.cards} to read`
              : "Reply ideas written"
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
          {count} {count === 1 ? "thread has" : "threads have"} no reply idea yet
        </b>
        <div className="meta">Sales writes a help-first idea for each, under each community&apos;s rules. You write the reply in your own words and post it yourself.</div>
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
          Write the ideas
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

/**
 * The free scan's result (canvas FreeResult): how many people it found, why their replies are locked, one way on.
 * The count is the threads on screen worth a reply; nothing here is estimated.
 */
function FreeResult({ count, onPlan }: { count: number; onPlan: () => void }) {
  return (
    <section className="card" data-testid="sales-free-result" style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
      <b style={{ fontSize: "16px" }}>
        {count} {count === 1 ? "person asked" : "people asked"} about the problem you solve in the last 30 days.
      </b>
      <p className="meta" style={{ margin: "0" }}>
        Read what each one wrote below. With a plan, Ferreto writes a reply to each, checked against the community&apos;s rules, and a DM or an email when someone is ready for one.
      </p>
      <div>
        <button type="button" className="primary" onClick={onPlan}>
          See plans
        </button>
      </div>
    </section>
  );
}

function NoOneAsked({ scan, onEdit, freeLeft }: { scan: NonNullable<SalesScreen["lastScan"]>; onEdit: () => void; freeLeft: boolean }) {
  const answered = scan.platforms.filter((p) => !scan.failed.includes(p));
  // Review 2026-11-21: with a place down, "no one asked" would claim more than was read. Say where we looked.
  const headline = scan.failed.length && answered.length
    ? `No one asked on ${places(answered)} in the last 30 days. ${places(scan.failed)} did not answer, so this is not the whole picture.`
    : "No one asked about this in the last 30 days.";
  return (
    <section className="card" data-testid="sales-none" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
      <h2 style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>{headline}</h2>
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
      {freeLeft ? (
        <p style={{ margin: "0", fontSize: "14px" }} data-testid="sales-none-free-left">
          This scan did not use up your free scan: you can run it again, after changing what Sales looks for if you like.
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <a className="ghost" href="/app/business?d=strategy" style={{ textDecoration: "none" }}>
          Edit Strategy
        </a>
        <button type="button" className="ghost" onClick={onEdit}>
          Edit what Sales looks for
        </button>
      </div>
    </section>
  );
}

/**
 * The reply idea Sales wrote and the founder's own reply under it (owner, 2026-11-23): a finished, pasted reply reads
 * like a reply farm. The idea shows as Idea / Solution with words to say; the founder writes the reply in the box, and
 * the badge turns green once most of it is their own words.
 */
function ReplyIdea({ id, idea, mine, onMine, done, checks }: { id: string; idea: string; mine: string; onMine: (text: string) => void; done: boolean; checks: string | null }) {
  const share = ownShare(mine, idea);
  const yours = share >= OWN_ENOUGH;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <IdeaDraft draft={idea} />
      {done ? (
        checks ? <div className="meta">{checks}</div> : null
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <label htmlFor={`reply-${id}`} style={{ fontSize: "12px", fontWeight: "700", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)" }}>
              Your reply
            </label>
            <span style={{ flex: "1 1 auto" }}></span>
            <span className="idea-badge" data-mine={yours || undefined} data-testid={yours ? "reply-idea-edited" : "reply-idea-badge"}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={yours ? "M20 6 9 17l-5-5" : "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"} />
              </svg>
              {yours ? `${share}% yours` : `Write it in your own words · ${share}%`}
            </span>
          </div>
          <textarea id={`reply-${id}`} className="idea-mine" value={mine} onChange={(e) => onMine(e.target.value)} rows={4} placeholder="Say it the way you would, with what you know first-hand" />
          <div className="idea-meter" role="meter" aria-label="Your own words" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
            <span style={{ width: `${share}%` }}></span>
          </div>
          {checks ? <div className="meta">{checks}</div> : null}
        </>
      )}
    </div>
  );
}

/**
 * One thread: a row that opens in place, or, on a phone (`onBack`), the open person full width with a way back to the
 * list and its actions held at the bottom of the screen (canvas board "Sales on a phone").
 */
/**
 * What the person wrote, first thing in an open card (owner, 2026-11-23: "I need to read their post before I can write a
 * reply"). Long posts fold to eight lines. A Reddit card saved before posts were read has only its title: the link to
 * read it on the platform takes the post's place.
 */
function RuleBadge({ t }: { t: Thread }) {
  const kind = t.rule.kind;
  const tone = kind === "mention_allowed" || kind === "requires_disclosure" ? "ok" : kind === "skipped" ? "no" : "help";
  return (
    <div className="rule-badge-row" data-testid="sales-rule">
      <span className="rule-badge" data-tone={tone}>
        {ruleHeadline(t)}
      </span>
      {t.rule.text ? <span className="meta">{t.rule.text}</span> : null}
    </div>
  );
}

function TheirPost({ t }: { t: Thread }) {
  const [all, setAll] = useState(false);
  const body = (t.body ?? "").trim();
  const where = PLATFORM_LABEL[t.platform] ?? "the thread";
  const long = body.length > 520;
  return (
    <div className="their-post" data-testid="sales-their-post">
      <div className="their-post-head">
        <PlatformBadge platform={t.platform} size={16} />
        <span>{t.author ? `${t.author} wrote` : "They wrote"}</span>
      </div>
      {body ? (
        <>
          <p className="their-post-text" data-folded={long && !all ? "" : undefined}>
            {body}
          </p>
          {long ? (
            <button type="button" className="their-post-more" onClick={() => setAll((v) => !v)}>
              {all ? "Show less" : "Read the whole post"}
            </button>
          ) : null}
        </>
      ) : (
        <a className="their-post-open" href={t.url} target="_blank" rel="noopener noreferrer">
          Read their post on {where} before you reply ↗
        </a>
      )}
    </div>
  );
}

function ThreadRow({ t, free, open, onToggle, onBack, onPlan, onDecide, onSent }: { t: Thread; free: boolean; open: boolean; onToggle: () => void; onBack?: () => void; onPlan: (action: string) => void; onDecide: (t: Thread, action: "replied" | "dismissed", reason?: string, text?: string) => Promise<void>; onSent: (t: Thread, via: "dm" | "email") => Promise<void> }) {
  // The founder's own reply. The idea (`t.draft`) shows above it and is never the text that gets copied.
  const [draft, setDraft] = useState("");
  // Copy and open waits until most of the reply is the founder's own words (owner, 2026-11-23).
  const edited = ownShare(draft, t.draft ?? "") >= OWN_ENOUGH;
  const [copied, setCopied] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const skipped = t.rule.kind === "skipped";
  const done = t.status !== "open";
  // Free: the reply is written (or shown) once the founder picks a plan. Until then the thread is still worth reading.
  const locked = free && !skipped && t.draft === null;
  const lead = t.quotes[0] ?? null;

  function copyAndOpen() {
    // The tab opens in the click itself: opened after an await, Safari and some Chrome setups block it as a popup
    // (owner, 2026-11-23: "the Reddit link often does not open"). The copy starts first and finishes on its own.
    const copying = navigator.clipboard?.writeText(draft) ?? Promise.reject(new Error("no clipboard"));
    window.open(t.url, "_blank", "noopener,noreferrer");
    copying.then(
      () => setCopied(true),
      () => {
        // The thread still opened; the founder can select the draft and copy it by hand.
      },
    );
  }
  async function run(action: "replied" | "dismissed", why?: string) {
    setBusy(true);
    // The reply that counts is the one the founder posted: an edited draft goes with "replied", so the 1-in-10 mention
    // rule and the learning read what went out, not the draft.
    const posted = draft.trim();
    await onDecide(t, action, why, action === "replied" && posted ? posted.slice(0, 3000) : undefined);
    setBusy(false);
  }

  return (
    <div className={onBack ? "th th-person" : "th"} data-open={open} data-thread={t.id} role={onBack ? undefined : "listitem"}>
      {onBack ? (
        <>
          <div className="th-phonehead">
            <button type="button" className="ib th-back" aria-label="Back to people" onClick={onBack}>
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span className="meta" style={{ flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[t.community !== PLATFORM_LABEL[t.platform] ? t.community : PLATFORM_LABEL[t.platform], t.postedAt ? ago(t.postedAt) : null].filter(Boolean).join(" · ")}
            </span>
            <span className={tone(t.score)}>{matchLabel(t.score)}</span>
          </div>
          <h1 className="th-title">{t.title}</h1>
        </>
      ) : null}
      <button type="button" className="row" onClick={onToggle} aria-expanded={open} hidden={Boolean(onBack)}>
        {hasLogo(t.platform) ? <PlatformBadge platform={t.platform} size={30} label={PLATFORM_LABEL[t.platform]} dim={done} /> : null}
        <span style={{ flex: "1 1 auto", minWidth: "0" }}>
          <span style={{ display: "block", fontSize: "14.5px", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: done ? "var(--muted)" : undefined }}>{t.title}</span>
          <span className="meta icon-meta">
            {t.community !== PLATFORM_LABEL[t.platform] ? <span>{t.community}</span> : null}
            {t.postedAt ? (
              <span title={`Posted ${ago(t.postedAt)}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                {ago(t.postedAt).replace(/ ago$/, "")}
              </span>
            ) : null}
            {t.comments != null ? (
              <span title={`${t.comments} comments`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
                </svg>
                {t.comments}
              </span>
            ) : null}
            {done ? (
              <span style={{ color: t.status === "replied" ? "var(--sec-idea)" : undefined, fontWeight: "600" }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={t.status === "replied" ? "M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4" : "M18 6 6 18M6 6l12 12"} />
                </svg>
                {t.status === "replied" ? "Replied" : "Dismissed"}
              </span>
            ) : null}
          </span>
          {lead && !open && !done ? (
            <span className="quote" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: "6px", fontSize: "13.5px" }}>
              “{bare(lead.text)}”
            </span>
          ) : null}
        </span>
        <span className="score-sq" data-strong={t.score >= STRONG_MATCH || undefined} data-weak={t.score < 50 || undefined} title={`${matchLabel(t.score)} · ${t.score}/100`} aria-label={`${matchLabel(t.score)}, ${t.score} of 100`}>
          {t.score}
        </span>
        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--subtle)" }}>
          <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open ? (
        <div className="th-body">
          <TheirPost t={t} />
          {oldDays(t.postedAt) !== null ? (
            <p className="meta" style={{ margin: "0" }} data-testid="sales-old-thread">
              Old thread: posted {oldDays(t.postedAt)} days ago. Reply only if people are still answering in it.
            </p>
          ) : null}
          {t.quotes.length ? (
            <div>
              <div className="meta" style={{ marginBottom: "6px" }}>
                {matchLabel(t.score)} ({t.score}/100): how it was counted
              </div>
              {t.quotes.map((q) => (
                <p key={q.text} className="quote" style={{ marginBottom: "6px" }}>
                  {isTheirWords(q.from) ? `“${bare(q.text)}”` : bare(q.text)} <span className="meta">· {q.from}</span>
                </p>
              ))}
            </div>
          ) : null}
          <RuleBadge t={t} />
          {skipped ? (
            <div className="meta">Sales did not draft a reply. The community&apos;s rules leave no room for one.</div>
          ) : locked ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }} data-testid="sales-reply-locked">
              <span className="meta" style={{ flex: "1 1 220px" }}>
                {t.drafted ? "Your reply idea is written. You see it once you pick a plan." : "Your reply idea is written once you pick a plan."}
              </span>
              <button type="button" className="primary" onClick={() => onPlan("reply to these people")}>
                Pick a plan
              </button>
            </div>
          ) : t.draft === null ? (
            <div className="meta">No reply idea yet. Write the ideas above, or reply in your own words and mark it replied.</div>
          ) : t.person && t.status !== "dismissed" ? (
            <ReachPanel
              t={t}
              onSent={(via) => onSent(t, via)}
              publicReply={
                <ReplyIdea id={t.id} idea={t.draft} mine={draft} onMine={setDraft} done={done} checks={t.draftChecks} />
              }
            />
          ) : (
            <ReplyIdea id={t.id} idea={t.draft} mine={draft} onMine={setDraft} done={done} checks={t.draftChecks} />
          )}
          {done ? (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="ghost" style={{ textDecoration: "none" }}>
                Open thread
              </a>
            </div>
          ) : (
            <div className="th-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
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
                <button
                  type="button"
                  className="primary"
                  disabled={!draft.trim() || !edited}
                  title={edited ? undefined : "Write most of the reply in your own words first"}
                  onClick={() => void copyAndOpen()}
                >
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
  // On a phone the list comes first and a thread opens full width (wave 4 C1); on a wide screen the first opens in place.
  const phone = usePhone();

  useEffect(() => {
    if (!data) return;
    setThreads([...data.threads].sort((a, b) => b.score - a.score));
    setWeek(data.week);
    if (!phone) setOpen((was) => was ?? data.threads.find((t) => t.status === "open")?.id ?? null);
  }, [data, phone]);

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
      // On a phone a decision goes back to the list, where "Where did you post it?" waits on top.
      setOpen(phone ? null : ((threads ?? []).find((x) => x.id !== t.id && x.status === "open")?.id ?? null));
      if (phone) window.scrollTo(0, 0);
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
  const usageState = useUsageState();
  const paused = usage?.paused ? (usage.resetsAt ? new Date(usage.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "the next reset") : null;

  // The banner's way to the settings: the tab, then the cursor on its heading, so the founder lands where to act.
  // The person open full width on a phone: the page shows that thread alone, with a way back to where the list was.
  const person = phone && tab === "threads" ? (list.find((t) => t.id === open) ?? null) : null;
  const backTo = useRef<string | null>(null);
  // Keyed on the id: `person` is a new object after every reload or draft update, and scrolling to the top each time
  // pulled the founder away from the reply they were reading or typing.
  const personId = person?.id ?? null;
  useEffect(() => {
    if (personId) {
      backTo.current = personId;
      window.scrollTo(0, 0);
    } else if (backTo.current) {
      document.querySelector(`[data-thread="${CSS.escape(backTo.current)}"]`)?.scrollIntoView({ block: "center" });
      backTo.current = null;
    }
  }, [personId]);

  const openSettings = () => {
    setTab("settings");
    requestAnimationFrame(() => document.getElementById("sales-settings-title")?.focus());
  };

  if (person) {
    return (
      <div className="sales-phone" data-testid="v2-sales" data-person="open">
        <main>
          {error ? <div className="meta" style={{ margin: "0 0 10px", color: "var(--warn)" }}>{error}</div> : null}
          <ThreadRow key={person.id} t={person} free={free} open onToggle={() => setOpen(null)} onBack={() => setOpen(null)} onPlan={setPlanFor} onDecide={decide} onSent={(x, via) => decide(x, "replied", undefined, undefined, false, via)} />
        </main>
        <PlanSheet open={planFor !== null} onClose={() => setPlanFor(null)} action={planFor ?? undefined} />
      </div>
    );
  }

  return (
    <div className="sales-page" data-sec="find" style={{ display: "flex", flexWrap: "wrap", maxWidth: "1320px", margin: "0 auto", padding: "22px 24px 40px", gap: "24px" }} data-testid="v2-sales">
      <main style={{ flex: "999 1 600px", minWidth: "0" }}>
        <div className="sec-band">
          <span className="sec-tile">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 200px", minWidth: "0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h1>Sales</h1>
              {lastScan ? (
                <span className="sec-chip" title="Last scan" style={{ color: "var(--ok)" }}>
                  <span className="live"></span>
                  {ago(lastScan) === "just now" ? "Scanned just now" : `Scanned ${ago(lastScan)} ago`}
                </span>
              ) : null}
            </div>
            {/* Where it looks, as the platforms' own icons (owner, 2026-11-23: fewer words). */}
            <span className="pl-row" aria-label={`Looks on ${(data?.settings.platforms ?? SALES_PLATFORMS).map((p) => PLATFORM_LABEL[p]).join(", ")}`}>
              {SALES_PLATFORMS.map((p) => (hasLogo(p) ? <PlatformBadge key={p} platform={p} size={20} dim={!(data?.settings.platforms ?? SALES_PLATFORMS).includes(p)} /> : null))}
            </span>
          </div>
          <span className="sec-stat" title="Replied since Monday" style={{ color: "var(--sec-idea)" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
            {week?.replied ?? 0}
          </span>
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
        {/* 100% used (wave 4 C2): what stopped, until when, what still works. The shell's bar still disables Scan now. */}
        <AllowanceBanner state={usageState} testId="sales-paused" />

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
            {free && worth.length > 0 ? <FreeResult count={worth.length} onPlan={() => setPlanFor("reply to these people")} /> : null}
            {live && undrafted > 0 ? <WriteReplies count={undrafted} busy={scanActive(scan) && scan.kind === "sales_reply_drafts"} onPlan={setPlanFor} onStarted={startedScan} /> : null}
            {list.length === 0 && data.lastScan?.verdict === "none" ? <NoOneAsked scan={data.lastScan} onEdit={openSettings} freeLeft={freeLeft} /> : null}
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
              <div key={p} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0" }}>
                {hasLogo(p) ? <PlatformBadge platform={p} size={26} dim={!on} /> : null}
                <span style={{ flex: "1", color: on ? undefined : "var(--muted)" }}>
                  {PLATFORM_LABEL[p]}
                  {on && p === "reddit" && excluded ? <span className="meta"> · {excluded} excluded</span> : null}
                </span>
                <button type="button" className="sw" role="switch" aria-checked={on} aria-label={`${PLATFORM_LABEL[p]}: change in Settings`} title="Change in Settings" onClick={() => setTab("settings")}></button>
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
