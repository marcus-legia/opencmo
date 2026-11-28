"use client";

import { OWN_ENOUGH, ownShare } from "@/lib/cmo/idea";
import { STRONG_MATCH, matchLabel } from "@/lib/cmo/match";
import { oldDays, ruleHeadline, scanSections } from "@/lib/cmo/sales-card";
import { bare, isTheirWords } from "@/lib/cmo/quote";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Logs } from "@/app/api/v1/logs/route";
import { PlanSheet, isPlanRequired } from "@/components/billing/PlanSheet";
import { AllowanceBanner, useUsageState } from "@/components/billing/UsageNotice";
import { api, jsonBody } from "@/components/clipping/api";
import { useLive } from "@/components/clipping/useLive";
import { useScreen } from "@/components/screens/useScreen";
import { useOptionalShellState } from "@/components/shell-v2/ShellState";
import { costLine, salesScanCard } from "@/lib/cmo/jobs/price-card";
import { JOB_PRICES } from "@/lib/cmo/jobs/progress";
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";
import type { SalesScreen } from "@/lib/screens/sales";
import { createClient } from "@/lib/supabase/client";

import { IdeaDraft } from "./IdeaDraft";
import { PageHeader } from "./PageHeader";
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
const tone = (score: number) => (score >= STRONG_MATCH ? "hi" : score >= 60 ? "mid" : "lo");

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
    <section className="ui-card" role="status" aria-live="polite" style={{ marginTop: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {active ? <span className="live"></span> : null}
        <b style={{ flex: "1 1 auto" }}>{title}</b>
        {active ? null : (
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>
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

type ScanStepState = "idle" | "confirm" | "busy";

/**
 * Scan now: the same card as a scan asked in the CMO chat, with its cost line (owner test 2026-11-23); nothing runs
 * until the founder approves it. An unpaid account's first scan is free (`cmo_first_run_free`); after it, the button
 * opens the plan sheet instead of answering with the 402's text. The button is the page header's primary action; the
 * confirm card opens under the header (redesign 2026-11-28), so the header stays one line.
 */
function useScanNow({ free, freeLeft, onPlan, onStarted }: { free: boolean; freeLeft: boolean; onPlan: (action: string) => void; onStarted: (run: { id: string; status: string; created_at: string }) => void }) {
  const [step, setStep] = useState<ScanStepState>("idle");
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
  return { step, setStep, error, open, start };
}

function ScanNowButton({ scanning, paused, freeLeft, scan }: { scanning: boolean; paused: boolean; freeLeft: boolean; scan: ReturnType<typeof useScanNow> }) {
  if (scanning) {
    return (
      <span className="ui-chip" data-tone="accent">
        <span className="live"></span>Scanning…
      </span>
    );
  }
  return (
    <button type="button" className="ui-btn ui-btn--primary" onClick={scan.open} disabled={paused || scan.step !== "idle"} aria-expanded={scan.step !== "idle"} title={paused ? "New scans wait for the allowance to reset" : undefined}>
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      {freeLeft ? "Scan now · free" : "Scan now"}
    </button>
  );
}

function ScanNowConfirm({ platforms, freeLeft, scan }: { platforms?: SalesPlatform[]; freeLeft: boolean; scan: ReturnType<typeof useScanNow> }) {
  // The card names the places the founder's switches leave on: the scan searches those only.
  const card = salesScanCard(undefined, platforms);
  if (scan.step === "idle") return scan.error ? <p className="sl-note" role="alert">{scan.error}</p> : null;
  return (
    <div className="ui-card sl-confirm" role="group" aria-labelledby="scan-now-title">
      <h2 id="scan-now-title" className="sl-confirm-title">
        {freeLeft ? "Your free scan" : "Scan now"}
      </h2>
      <ul className="sl-confirm-list">
        {card.changes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="sl-note" data-testid="scan-cost">
        {costLine(card.credits, freeLeft)}
      </p>
      {scan.error ? (
        <p className="sl-note" role="alert" data-tone="warn">
          {scan.error}
        </p>
      ) : null}
      <div className="ui-row sl-end">
        <button type="button" className="ui-btn ui-btn--quiet" disabled={scan.step === "busy"} onClick={() => scan.setStep("idle")}>
          Cancel
        </button>
        <button type="button" className="ui-btn ui-btn--primary" disabled={scan.step === "busy"} onClick={() => void scan.start()}>
          {scan.step === "busy" ? "Starting…" : freeLeft ? "Start the free scan" : "Start the scan"}
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
    <div className="ui-card" role="group" aria-labelledby="write-replies-title" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
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
        <span className="ui-chip">
          <span className="live"></span>Writing…
        </span>
      ) : step === "idle" ? (
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => setStep("confirm")}>
          Write the ideas
        </button>
      ) : (
        <span style={{ display: "inline-flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span className="meta" data-testid="write-cost">{costLine(JOB_PRICES.sales_reply_drafts ?? 0)}</span>
          <button type="button" className="ui-btn ui-btn--quiet" disabled={step === "busy"} onClick={() => setStep("idle")}>
            Cancel
          </button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={step === "busy"} onClick={() => void start()}>
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
    <section className="ui-card" data-testid="sales-while-you-wait" style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
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
    <div className="ui-card" role="status" data-testid={testId} style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: "0" }}>
        <b>{title}</b>
        <div className="meta">{detail}</div>
      </div>
      {action?.href ? (
        <a href={action.href} className="ui-btn ui-btn--ghost">
          {action.label}
        </a>
      ) : action?.onClick ? (
        <button type="button" className="ui-btn ui-btn--ghost" onClick={action.onClick}>
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
    <section className="ui-card" data-testid="sales-free-result" style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
      <b style={{ fontSize: "16px" }}>
        {count} {count === 1 ? "person asked" : "people asked"} about the problem you solve in the last 30 days.
      </b>
      <p className="meta" style={{ margin: "0" }}>
        Read what each one wrote below. With a plan, Ferreto writes a reply to each, checked against the community&apos;s rules, and a DM or an email when someone is ready for one.
      </p>
      <div>
        <button type="button" className="ui-btn ui-btn--primary" onClick={onPlan}>
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
    <section className="ui-card" data-testid="sales-none" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
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
        <a className="ui-btn ui-btn--ghost" href="/app/business?d=strategy">
          Edit Strategy
        </a>
        <button type="button" className="ui-btn ui-btn--ghost" onClick={onEdit}>
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
            <label htmlFor={`reply-${id}`} className="ui-label sl-reply-label">
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
          <textarea id={`reply-${id}`} className="idea-mine ui-input" value={mine} onChange={(e) => onMine(e.target.value)} rows={4} placeholder="Say it the way you would, with what you know first-hand" />
          <div className="idea-meter" role="meter" aria-label="Your own words" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
            <span style={{ width: `${share}%` }}></span>
          </div>
          {checks ? <div className="meta">{checks}</div> : null}
        </>
      )}
    </div>
  );
}

/** The community's rule as one badge (`ruleHeadline`), with the rule reader's line beside it. */
function RuleBadge({ t }: { t: Thread }) {
  const kind = t.rule.kind;
  const tone = kind === "mention_allowed" || kind === "requires_disclosure" ? "ok" : kind === "skipped" ? "danger" : "warn";
  return (
    <div className="sl-rule" data-testid="sales-rule">
      <span className="ui-chip" data-tone={tone}>
        {ruleHeadline(t)}
      </span>
      {t.rule.text ? <span className="sl-note">{t.rule.text}</span> : null}
    </div>
  );
}

/** Lower case, one space: how a quote is matched against the post it came from. */
const flat = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Bug 6 (production 2026-11-28): the pain quote is usually a sentence of the post, so the card showed the same words
 * twice. A quote that is already in the post shown above is marked there instead, and not repeated under "Why".
 */
function inPost(body: string, quote: string): boolean {
  const q = flat(bare(quote));
  return q.length >= 4 && flat(body).includes(q);
}

/** The post with its quoted words marked, once each. Only exact (case-insensitive) runs are marked. */
function Marked({ body, quotes }: { body: string; quotes: string[] }) {
  const lower = body.toLowerCase();
  const spans: [number, number][] = [];
  for (const q of quotes) {
    const needle = bare(q).toLowerCase();
    if (needle.length < 4) continue;
    const at = lower.indexOf(needle);
    if (at >= 0 && !spans.some(([a, b]) => at < b && at + needle.length > a)) spans.push([at, at + needle.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let from = 0;
  for (const [a, b] of spans) {
    if (a > from) out.push(body.slice(from, a));
    out.push(<mark key={a}>{body.slice(a, b)}</mark>);
    from = b;
  }
  out.push(body.slice(from));
  return <>{out}</>;
}

/**
 * What the person wrote, first thing in an open card (owner, 2026-11-23: "I need to read their post before I can write a
 * reply"). Long posts fold to eight lines. A Reddit card saved before posts were read has only its title: the link to
 * read it on the platform takes the post's place. Their quoted words are marked in the text.
 */
function TheirPost({ t }: { t: Thread }) {
  const [all, setAll] = useState(false);
  const body = (t.body ?? "").trim();
  const where = PLATFORM_LABEL[t.platform] ?? "the thread";
  const long = body.length > 520;
  const said = t.quotes.filter((q) => isTheirWords(q.from)).map((q) => q.text);
  // No post text: the person's own words still show once, as the quote.
  const lead = !body ? (said[0] ?? null) : null;
  return (
    <div className="sl-post" data-testid="sales-their-post">
      <div className="sl-post-head">{t.author ? `${t.author} wrote` : "They wrote"}</div>
      {body ? (
        <>
          <p className="sl-post-text" data-folded={long && !all ? "" : undefined}>
            <Marked body={body} quotes={said} />
          </p>
          {long ? (
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm sl-more" onClick={() => setAll((v) => !v)}>
              {all ? "Show less" : "Read the whole post"}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {lead ? <p className="sl-post-text">“{bare(lead)}”</p> : null}
          <a className="sl-link" href={t.url} target="_blank" rel="noopener noreferrer">
            Read their post on {where} before you reply ↗
          </a>
        </>
      )}
    </div>
  );
}

/**
 * Why the score: the five parts and the lines they were counted from (redesign 2026-11-28, progressive disclosure). A
 * quote already shown in the post above is not repeated (bug 6).
 */
function WhyRows({ t }: { t: Thread }) {
  const body = (t.body ?? "").trim();
  const shownAbove = (text: string) => (body ? inPost(body, text) : t.quotes.find((q) => isTheirWords(q.from))?.text === text);
  const lineFor = (label: string) => t.quotes.find((q) => q.from.trim().toLowerCase() === label.toLowerCase()) ?? null;
  return (
    <div className="sl-why" data-testid="sales-why">
      <p className="sl-note">
        {matchLabel(t.score)}: {t.score} of 100
      </p>
      {t.parts.length ? (
        <ul className="sl-parts">
          {t.parts.map((p) => {
            const line = lineFor(p.label);
            const above = line ? shownAbove(line.text) : false;
            return (
              <li key={p.label}>
                <span className="sl-part-label">{p.label}</span>
                <span className="ui-meter" aria-hidden="true">
                  <span style={{ width: `${Math.round((p.score / p.max) * 100)}%` }}></span>
                </span>
                <span className="sl-part-score ui-num">
                  {p.score}/{p.max}
                </span>
                {line ? (
                  <span className="sl-part-line">{above ? "Their words, marked in the post above" : isTheirWords(line.from) ? `“${bare(line.text)}”` : bare(line.text)}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        t.quotes
          .filter((q) => !shownAbove(q.text))
          .map((q) => (
            <p key={q.text} className="sl-part-line">
              {isTheirWords(q.from) ? `“${bare(q.text)}”` : bare(q.text)} <span className="sl-note">· {q.from}</span>
            </p>
          ))
      )}
    </div>
  );
}

/** "Why 67": closed by default, so the card shows the decision first. */
function Why({ t, children, testId }: { t: Thread; children?: React.ReactNode; testId?: string }) {
  return (
    <details className="ui-disclosure sl-whybox" data-testid={testId}>
      <summary>Why {t.score}</summary>
      <WhyRows t={t} />
      {children}
    </details>
  );
}

const CLOCK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const BUBBLE = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
  </svg>
);

/**
 * One thread: a card that opens in place, or, on a phone (`onBack`), the open person full width with a way back to the
 * list and its actions held at the bottom of the screen (canvas board "Sales on a phone"). Closed, it shows who, one
 * quote and the score; open, the post, the rule, the reply idea and the one next action. The score's parts and the
 * reach checks wait behind "Why" (redesign 2026-11-28). `n` is its number in the list as shown (bug 7).
 */
function ThreadRow({ t, n, free, open, onToggle, onBack, onPlan, onDecide, onSent }: { t: Thread; n?: number; free: boolean; open: boolean; onToggle: () => void; onBack?: () => void; onPlan: (action: string) => void; onDecide: (t: Thread, action: "replied" | "dismissed", reason?: string, text?: string) => Promise<void>; onSent: (t: Thread, via: "dm" | "email") => Promise<void> }) {
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
  // The one quote a closed card shows: the person's own words, the pain first.
  const lead = t.quotes.find((q) => isTheirWords(q.from)) ?? t.quotes[0] ?? null;
  const where = t.community !== PLATFORM_LABEL[t.platform] ? t.community : PLATFORM_LABEL[t.platform];

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

  const reply = <ReplyIdea id={t.id} idea={t.draft ?? ""} mine={draft} onMine={setDraft} done={done} checks={t.draftChecks} />;
  const withPerson = !skipped && !locked && t.draft !== null && Boolean(t.person) && t.status !== "dismissed";

  return (
    <div className={`${onBack ? "th th-person" : "th ui-card ui-card--flush"} sl-thread`} data-open={open} data-done={done || undefined} data-active={open && !onBack ? "" : undefined} data-thread={t.id} id={onBack ? undefined : `thread-${t.id}`} role={onBack ? undefined : "listitem"}>
      {onBack ? (
        <>
          <div className="th-phonehead">
            <button type="button" className="ui-btn ui-btn--quiet ui-btn--icon th-back" aria-label="Back to people" onClick={onBack}>
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span className="sl-meta sl-ellipsis">{[where, t.postedAt ? ago(t.postedAt) : null].filter(Boolean).join(" · ")}</span>
            <span className="sl-score" data-tone={tone(t.score)}>
              <b className="ui-num">{t.score}</b> {matchLabel(t.score)}
            </span>
          </div>
          <h1 className="th-title">{t.title}</h1>
        </>
      ) : null}
      <button type="button" className="row sl-head" onClick={onToggle} aria-expanded={open} hidden={Boolean(onBack)}>
        <span className="sl-head-main">
          <span className="sl-meta">
            {hasLogo(t.platform) ? <PlatformBadge platform={t.platform} size={16} label={PLATFORM_LABEL[t.platform]} dim={done} /> : null}
            {where !== PLATFORM_LABEL[t.platform] || !hasLogo(t.platform) ? <span>{where}</span> : null}
            {t.postedAt ? (
              <span title={`Posted ${ago(t.postedAt)} ago`}>
                {CLOCK}
                {ago(t.postedAt)}
              </span>
            ) : null}
            {t.comments != null ? (
              <span title={`${t.comments} comments`}>
                {BUBBLE}
                {t.comments}
              </span>
            ) : null}
            {done ? (
              <span className="ui-chip" data-tone={t.status === "replied" ? "ok" : undefined}>
                {t.status === "replied" ? "Replied" : "Dismissed"}
              </span>
            ) : skipped ? (
              <span className="ui-chip">Don&apos;t reply here</span>
            ) : null}
            {t.usedIn?.length ? <span>↳ Post #{t.usedIn.map((p) => p.no).join(", #")}</span> : null}
          </span>
          <span className="sl-title">
            {n ? (
              <span className="sl-no ui-num" data-testid="sales-no">
                {n}
              </span>
            ) : null}
            {t.title}
          </span>
          {lead && !open && !done ? <span className="sl-quote">“{bare(lead.text)}”</span> : null}
        </span>
        <span className="sl-head-side">
          <span className="sl-score" data-tone={tone(t.score)} title={`${matchLabel(t.score)} · ${t.score}/100`} aria-label={`${matchLabel(t.score)}, ${t.score} of 100`}>
            <b className="ui-num">{t.score}</b>
            <span className="sl-score-word">{matchLabel(t.score)}</span>
          </span>
          <svg className="i s sl-chev" viewBox="0 0 24 24" aria-hidden="true">
            <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="th-body sl-body">
          {t.usedIn?.length ? (
            <div className="ui-row" data-testid="sales-used-in">
              <span className="sl-note">Used in</span>
              {t.usedIn.map((p) => (
                <a key={p.id} className="sl-link" href={`/app/writer#post-${p.id}`}>
                  Post #{p.no}
                </a>
              ))}
            </div>
          ) : null}
          <TheirPost t={t} />
          {oldDays(t.postedAt) !== null ? (
            <p className="sl-note" data-testid="sales-old-thread">
              Old thread: posted {oldDays(t.postedAt)} days ago. Reply only if people are still answering in it.
            </p>
          ) : null}
          {withPerson ? null : <Why t={t} />}
          <RuleBadge t={t} />
          {skipped ? (
            <p className="sl-note">Sales did not draft a reply. The community&apos;s rules leave no room for one.</p>
          ) : locked ? (
            <div className="ui-row sl-locked" data-testid="sales-reply-locked">
              <span className="sl-note">{t.drafted ? "Your reply idea is written. You see it once you pick a plan." : "Your reply idea is written once you pick a plan."}</span>
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => onPlan("reply to these people")}>
                Pick a plan
              </button>
            </div>
          ) : t.draft === null ? (
            <p className="sl-note">No reply idea yet. Write the ideas above, or reply in your own words and mark it replied.</p>
          ) : withPerson ? (
            <ReachPanel t={t} onSent={(via) => onSent(t, via)} why={(checks) => <Why t={t} testId="sales-reach-card">{checks}</Why>} publicReply={reply} />
          ) : (
            reply
          )}
          {done ? (
            <div className="ui-row sl-end">
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--ghost">
                Open thread
              </a>
            </div>
          ) : (
            <div className="th-actions ui-row sl-end">
              {dismissing ? (
                <>
                  <label className="sl-note" htmlFor={`why-${t.id}`}>
                    Reason
                  </label>
                  <select id={`why-${t.id}`} value={reason} onChange={(e) => setReason(e.target.value)} className="ui-input sl-select">
                    {DISMISS_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <button type="button" className="ui-btn ui-btn--ghost" disabled={busy} onClick={() => void run("dismissed", reason)}>
                    Dismiss
                  </button>
                </>
              ) : (
                <button type="button" className="ui-btn ui-btn--quiet" onClick={() => setDismissing(true)}>
                  Dismiss
                </button>
              )}
              {skipped ? null : locked ? (
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--ghost">
                  Open thread
                </a>
              ) : (
                <button type="button" className="ui-btn ui-btn--ghost" disabled={busy} onClick={() => void run("replied")}>
                  I replied
                </button>
              )}
              {!skipped && t.draft !== null ? (
                <button
                  type="button"
                  className="ui-btn ui-btn--primary primary"
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
/**
 * The subreddit most of a scan's Reddit threads are in: its "Write a post yourself" opens the Composer there
 * (2026-11-25). Null when the scan found no one on Reddit.
 */
function composeSub(threads: readonly { platform: string; community: string }[]): string | null {
  const counts = new Map<string, number>();
  for (const t of threads) {
    if (t.platform !== "reddit") continue;
    const sub = t.community.trim().replace(/^\/?r\//i, "");
    if (/^[A-Za-z0-9_]{2,21}$/.test(sub)) counts.set(sub, (counts.get(sub) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [sub, n] of counts) if (best === null || n > counts.get(best)!) best = sub;
  return best;
}

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
  // A link from a post ("From Scan #3 · 3.1", `#thread-<id>`) opens that person once the list is in (2026-11-25).
  const linked = useRef(false);
  const [linkGone, setLinkGone] = useState(false);
  useEffect(() => {
    if (linked.current || !threads) return;
    const id = window.location.hash.match(/^#thread-([0-9a-f-]{36})$/i)?.[1];
    if (!id) return;
    linked.current = true;
    // The list holds the newest people: an older one linked from a post says so instead of doing nothing.
    if (!threads.some((t) => t.id === id)) {
      setLinkGone(true);
      return;
    }
    setTab("threads");
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`thread-${id}`)?.scrollIntoView({ block: "start" }));
  }, [threads]);
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
    // The first person in the list as shown: the newest scan's best open thread (scanSections orders them so).
    if (!phone) setOpen((was) => was ?? scanSections(data.threads.filter((t) => t.status === "open" && t.rule.kind !== "skipped"), data.scans ?? [])[0]?.threads[0]?.id ?? null);
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
  // The list as shown (bug 7): people to reply to, a section per scan, numbered 1, 2, 3 down the page; everyone else
  // (replied, dismissed, or in a community that leaves no room for a reply) in one folded group under them.
  const worthIds = new Set(worth.map((t) => t.id));
  const toReply = data ? scanSections(worth, data.scans ?? []) : [];
  const numbers = new Map(toReply.flatMap((section) => section.threads).map((t, i) => [t.id, i + 1] as const));
  const rest = list.filter((t) => !worthIds.has(t.id));
  // The newest finished scan, or the newest Sales line in the log when the scan was read before that one.
  const lastScan = data?.lastScan?.at ?? runs[0]?.at ?? null;
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

  const scanNow = useScanNow({ free, freeLeft, onPlan: setPlanFor, onStarted: startedScan });

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

  const looks = data?.settings.platforms ?? SALES_PLATFORMS;
  const scanned = lastScan ? (ago(lastScan) === "just now" ? "Scanned just now" : `Scanned ${ago(lastScan)} ago`) : "No scan yet";
  const scanning = scanActive(scan) && scan.kind === "sales_scan";

  return (
    <div className="sales-page sl-page" data-testid="v2-sales">
      <main className="sl-main">
        <PageHeader
          title="Sales"
          status={data ? `${scanned} · ${list.length} checked` : scanned}
          platforms={looks.filter(hasLogo).map((p) => ({ id: p, label: PLATFORM_LABEL[p] }))}
          primary={<ScanNowButton scanning={scanning} paused={paused !== null} freeLeft={freeLeft} scan={scanNow} />}
        >
          <div className="ui-tabs" role="tablist" aria-label="Sales">
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
                {id === "following" && following > 0 ? <span className="ui-chip ui-num">{following}</span> : null}
              </button>
            ))}
          </div>
        </PageHeader>
        <ScanNowConfirm platforms={data?.settings.platforms} freeLeft={freeLeft} scan={scanNow} />
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

        {state.status === "loading" ? <div className="meta" style={{ marginTop: "14px" }}>Loading…</div> : null}
        {state.status === "error" ? <div className="meta" style={{ marginTop: "14px" }}>{state.message}</div> : null}
        {error ? <div className="meta" style={{ marginTop: "14px", color: "var(--warn)" }}>{error}</div> : null}
        {data?.stuck ? (
          <div className="ui-card" role="alert" style={{ marginTop: "14px" }}>
            <b>{data.stuck.text}</b>{" "}
            <button type="button" className="ui-btn ui-btn--ghost" onClick={openSettings} style={{ marginLeft: "8px" }}>
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
            {free && worth.length > 0 ? <FreeResult count={worth.length} onPlan={() => setPlanFor("reply to these people")} /> : null}
            {live && undrafted > 0 ? <WriteReplies count={undrafted} busy={scanActive(scan) && scan.kind === "sales_reply_drafts"} onPlan={setPlanFor} onStarted={startedScan} /> : null}
            {list.length === 0 && data.lastScan?.verdict === "none" ? <NoOneAsked scan={data.lastScan} onEdit={openSettings} freeLeft={freeLeft} /> : null}
            {list.length === 0 && data.lastScan?.verdict !== "none" ? (
              <div className="ui-empty">
                <p className="ui-empty__title">No threads yet</p>
                <p>Sales scans the communities your customers use and scores what it finds.</p>
              </div>
            ) : null}
            {linkGone ? (
              <p className="sl-note" role="status" data-testid="sales-link-gone">
                The person that post was written from is older than this list, so it is not shown here.
              </p>
            ) : null}
            {/* Bug 7 (production 2026-11-28): "3 worth a reply" sat over all 13 and scan numbers skipped. The people to
                reply to come first, numbered as shown, a section per scan by its time; the rest fold away below. */}
            {list.length ? (
              <h2 className="sl-group" data-testid="sales-to-reply">
                To reply <span className="ui-num">{worth.length}</span>
              </h2>
            ) : null}
            {list.length && !worth.length ? <p className="sl-note">Nothing waits on a reply. The next scan adds new people here.</p> : null}
            {toReply.map((section) => (
              <section key={section.key} className="sl-section" aria-label={section.scan?.at ? `Scan, ${runTime(section.scan.at)}` : "Earlier"} data-testid="sales-scan-section">
                <h3 className="sl-section-head">
                  <span>{section.scan?.at ? `Scan · ${runTime(section.scan.at)}` : section.scan ? "Scan" : "Earlier"}</span>
                  <span className="sl-note ui-num">
                    {section.threads.length
                      ? `${section.threads.length} ${section.threads.length === 1 ? "person" : "people"}`
                      : "no one worth a reply, credits given back"}
                  </span>
                  {composeSub(section.threads) ? (
                    <Link className="sl-link sl-section-link" href={`/app/compose?${new URLSearchParams({ platform: "reddit", sub: composeSub(section.threads)! })}`} data-testid="sales-write-yourself">
                      Write a post yourself in r/{composeSub(section.threads)}
                    </Link>
                  ) : null}
                </h3>
                {section.threads.length ? (
                  <div className="sl-list" role="list" aria-label={section.scan?.at ? `Threads, scan of ${runTime(section.scan.at)}` : "Threads, earlier"}>
                    {section.threads.map((t) => (
                      <ThreadRow key={t.id} t={t} n={numbers.get(t.id)} free={free} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onPlan={setPlanFor} onDecide={decide} onSent={(x, via) => decide(x, "replied", undefined, undefined, false, via)} />
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
            {rest.length ? (
              <details className="ui-disclosure sl-done" data-testid="sales-done">
                <summary>
                  Replied, dismissed or not for a reply <span className="ui-num">{rest.length}</span>
                </summary>
                <div className="sl-list" role="list" aria-label="Replied, dismissed or not for a reply">
                  {rest.map((t) => (
                    <ThreadRow key={t.id} t={t} free={free} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} onPlan={setPlanFor} onDecide={decide} onSent={(x, via) => decide(x, "replied", undefined, undefined, false, via)} />
                  ))}
                </div>
              </details>
            ) : null}
          </>
        ) : null}

        {tab === "runs" ? (
          <section className="ui-card sl-gap">
            {runs.length === 0 ? <p className="sl-note">No scans yet.</p> : null}
            {runs.map((r) => (
              <div key={r.id} className="sl-run">
                <span className="sl-note ui-num">{runTime(r.at)}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </section>
        ) : null}

        {tab === "settings" && data ? (
          <div className="v2 sl-gap">
            <SalesSettings initial={data.settings} live={Boolean(state.status === "ready" && state.live.settings)} onSaved={reload} />
          </div>
        ) : null}
      </main>

      <aside className="sl-side">
        <section className="ui-card">
          <div className="ui-card__head">
            {/* The funnel ("This week") is the Context column's; this box is the replies and the 1-in-10 mention rule. */}
            <h2>Your replies</h2>
            <span className="sl-note">since Mon</span>
          </div>
          <dl className="sl-stats">
            <div>
              <dt>replied</dt>
              <dd className="ui-num">{week?.replied ?? "–"}</dd>
            </div>
            <div>
              <dt>dismissed</dt>
              <dd className="ui-num">{week?.dismissed ?? "–"}</dd>
            </div>
            <div>
              <dt>named the product</dt>
              <dd className="ui-num">{data ? `${data.mentions.used}/${data.mentions.window}` : "–"}</dd>
            </div>
          </dl>
        </section>
        <section className="ui-card">
          <div className="ui-card__head">
            <h2>Recent runs</h2>
          </div>
          {runs.length === 0 ? <p className="sl-note">No scans yet.</p> : null}
          {runs.slice(0, 3).map((r) => (
            <div key={r.id} className="sl-run">
              <span className="sl-note ui-num">{runTime(r.at)}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </section>
        <section className="ui-card">
          <div className="ui-card__head">
            <h2>Where it looks</h2>
          </div>
          {SALES_PLATFORMS.map((p) => {
            const on = (data?.settings.platforms ?? SALES_PLATFORMS).includes(p);
            const excluded = data?.settings.excludedSubreddits.length ?? 0;
            return (
              <div key={p} className="sl-place" data-on={on || undefined}>
                {hasLogo(p) ? <PlatformBadge platform={p} size={20} dim={!on} /> : null}
                <span className="sl-place-name">
                  {PLATFORM_LABEL[p]}
                  {on && p === "reddit" && excluded ? <span className="sl-note"> · {excluded} excluded</span> : null}
                </span>
                <button type="button" className="sw" role="switch" aria-checked={on} aria-label={`${PLATFORM_LABEL[p]}: change in Settings`} title="Change in Settings" onClick={() => setTab("settings")}></button>
              </div>
            );
          })}
          <div className="sl-place sl-place--foot">
            <span className="sl-place-name">Term pairs</span>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setTab("settings")}>
              {data?.settings.pairs.length ?? 0} set
            </button>
          </div>
        </section>
      </aside>
      <PlanSheet open={planFor !== null} onClose={() => setPlanFor(null)} action={planFor ?? undefined} />
    </div>
  );
}
