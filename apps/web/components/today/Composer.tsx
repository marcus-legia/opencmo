"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { isPlanRequired, PlanSheet } from "@/components/billing/PlanSheet";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { useLive } from "@/components/clipping/useLive";
import { costLine } from "@/lib/cmo/jobs/price-card";
import { JOB_PRICES } from "@/lib/cmo/jobs/progress";
import { profileOf } from "@/lib/cmo/platforms";
import { LINKEDIN_SHARE, threadsIntent, xIntent } from "@/lib/departments/publish/intent";
import { liveCheck, REDDIT_TITLE_MAX } from "@/lib/composer/live-check";
import { sampleCheck, sampleContext } from "@/lib/composer/sample";
import { COMPOSE_PLATFORMS, type AccountContext, type ComposeCheckOutput, type ComposeIssue, type ComposePlatform, type ComposerContext, type SubredditContext } from "@/lib/composer/types";
import { createClient } from "@/lib/supabase/client";

import { PageHeader } from "./PageHeader";
import { PlatformBadge } from "./platform-logos";

/**
 * The Composer (spec docs/superpowers/specs/2026-11-25-composer-design.md): the founder writes the post; Ferreto shows
 * the sub's rules and whether the account is ready before they start, flags sentences in code on every change, and on
 * a button checks the post with AI against the sub's rules and no-ai-slop. Ferreto never writes the Reddit post and
 * never posts: the last step is Copy and open, from the founder's own account.
 *
 * The context and the check come from the data part (`GET /api/v1/composer/context`, the `compose_check` run);
 * `?sample=1` uses `lib/composer/sample.ts` instead, so the screen works before they are live.
 */

const LABEL: Record<ComposePlatform, string> = { reddit: "Reddit", x: "X", threads: "Threads", linkedin: "LinkedIn" };
const SUB_NAME = /^[A-Za-z0-9_]{2,21}$/;
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
// The check's price until the data part adds `compose_check` to `JOB_PRICES` (plan: `cmo_job_price('compose_check') = 1`).
const CHECK_CREDITS = JOB_PRICES.compose_check ?? 1;
// `cmo_runs.input` holds at most 4,096 bytes (its CHECK); the rest of the input (platform, sub, keys) fits in the margin.
const CHECK_INPUT_MAX = 4_000;
/** The route takes up to 3,000 characters of post (`POST /cmo/runs`, compose_check). */
const CHECK_BODY_MAX = 3_000;

const EMPTY_ACCOUNT: AccountContext = { username: null, karma: null, accountCreatedAt: null, postsInSub: null, lastPostInSubAt: null };
const localContext = (platform: ComposePlatform, account: AccountContext = EMPTY_ACCOUNT): ComposerContext => ({
  platform,
  subreddit: null,
  account,
  readiness: { level: platform === "reddit" ? "unknown" : "ready", reasons: [] },
});

const cleanSub = (s: string) => s.trim().replace(/^\/?r\//i, "");
const cleanUser = (s: string) => s.trim().replace(/^\/?u\//i, "");
const issueKey = (i: ComposeIssue) => `${i.source}\u0000${i.field}\u0000${i.rule}\u0000${i.quote}`;

/** The draft kept on this device per platform and sub, so a reload or a detour to Settings does not lose it. */
const draftKey = (platform: ComposePlatform, sub: string) => `ferreto.composer.${platform}${platform === "reddit" ? `.${sub.toLowerCase()}` : ""}`;
function loadDraft(key: string): { title: string; body: string } | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && typeof (v as { body?: unknown }).body === "string")
      return { title: typeof (v as { title?: unknown }).title === "string" ? (v as { title: string }).title : "", body: (v as { body: string }).body };
  } catch {
    // Storage blocked or a bad value: start empty.
  }
  return null;
}
function saveDraft(key: string, title: string, body: string) {
  try {
    if (!title && !body) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ title, body }));
  } catch {
    // Private window or full storage: the draft lives in the page only.
  }
}

/** Where Copy and open goes: Reddit's submit page for the sub, or the platform's composer. */
function openTarget(platform: ComposePlatform, sub: string, title: string, body: string): { url: string; label: string } {
  switch (platform) {
    case "reddit": {
      const q = new URLSearchParams({ title, text: body });
      return { url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/submit?${q.toString()}`, label: `Copy and open r/${sub}` };
    }
    case "x":
      return { url: xIntent(body), label: "Copy and open X" };
    case "threads":
      return { url: threadsIntent(body), label: "Copy and open Threads" };
    case "linkedin":
      return { url: LINKEDIN_SHARE, label: "Copy and open LinkedIn" };
  }
}

/** The text with each flagged quote underlined, drawn behind the textarea (same font and wrap) so the marks sit under the words. */
function Marks({ text, issues }: { text: string; issues: ComposeIssue[] }) {
  const ranges: { from: number; to: number; block: boolean }[] = [];
  for (const i of issues) {
    if (!i.quote) continue;
    const from = text.indexOf(i.quote);
    if (from >= 0) ranges.push({ from, to: from + i.quote.length, block: i.severity === "block" });
  }
  ranges.sort((a, b) => a.from - b.from);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.from < at) continue;
    if (r.from > at) parts.push(text.slice(at, r.from));
    parts.push(
      <mark key={r.from} className="cmp-mark" data-block={r.block || undefined}>
        {text.slice(r.from, r.to)}
      </mark>,
    );
    at = r.to;
  }
  parts.push(text.slice(at));
  // A trailing newline needs a character after it, or the backdrop is one line shorter than the textarea.
  return <>{parts}{"​"}</>;
}

function Editor({ id, label, value, onChange, issues, rows, maxLength, single }: { id: string; label: string; value: string; onChange: (v: string) => void; issues: ComposeIssue[]; rows: number; maxLength?: number; single?: boolean }) {
  const back = useRef<HTMLDivElement>(null);
  return (
    <div className="cmp-field">
      <label htmlFor={id} className="cmp-label">
        {label}
      </label>
      <div className="cmp-editor" data-single={single || undefined}>
        <div className="cmp-backdrop" ref={back} aria-hidden="true">
          <Marks text={value} issues={issues} />
        </div>
        <textarea
          id={id}
          className="cmp-input"
          rows={rows}
          value={value}
          maxLength={maxLength}
          spellCheck
          onChange={(e) => onChange(single ? e.target.value.replace(/\n/g, " ") : e.target.value)}
          onScroll={(e) => {
            if (back.current) back.current.scrollTop = e.currentTarget.scrollTop;
          }}
          data-testid={`composer-${id.replace(/^composer-/, "")}`}
        />
      </div>
    </div>
  );
}

const LEVEL: Record<ComposerContext["readiness"]["level"], [string, "ok" | "warn" | undefined]> = {
  ready: ["Account ready", "ok"],
  caution: ["Go carefully", "warn"],
  not_ready: ["Account not ready", "warn"],
  unknown: ["Account unknown", undefined],
};

const VERDICT: Partial<Record<SubredditContext["verdict"], string>> = {
  requires_disclosure: "say you built it",
  no_product_mention: "no product mentions",
  skip: "not a place to post about a product",
};

/** The rules' summary line, so they can stay folded: "11 rules · 100 karma · accounts 30+ days · promotion in a weekly thread". */
function rulesSummary(s: SubredditContext): string {
  const parts = [`${s.rules.length} ${s.rules.length === 1 ? "rule" : "rules"}`];
  if (s.minKarma) parts.push(`${s.minKarma.toLocaleString("en-US")}+ karma`);
  if (s.minAccountAgeDays) parts.push(`accounts ${s.minAccountAgeDays}+ days old`);
  if (s.megathread) parts.push("promotion in a weekly thread");
  if (VERDICT[s.verdict]) parts.push(VERDICT[s.verdict]!);
  return parts.join(" · ");
}

function accountLine(a: AccountContext, sub: string): string {
  const parts: string[] = [];
  if (a.karma !== null) parts.push(`${a.karma.toLocaleString("en-US")} karma`);
  if (a.accountCreatedAt) {
    const months = Math.max(0, Math.floor((Date.now() - new Date(a.accountCreatedAt).getTime()) / (30.44 * 86_400_000)));
    parts.push(months >= 12 ? `${Math.floor(months / 12)} ${months >= 24 ? "years" : "year"}` : `${months} ${months === 1 ? "month" : "months"}`);
  }
  // Null: the search could not tell (no username, a free account, or a page of posts elsewhere).
  if (a.postsInSub !== null) parts.push(`${a.postsInSub} ${a.postsInSub === 1 ? "post" : "posts"} in r/${sub} this year`);
  return parts.join(" · ");
}

function BeforeYouWrite({ context, sub, loading, error }: { context: ComposerContext; sub: string; loading: boolean; error: string | null }) {
  const s = context.subreddit;
  const [label, tone] = LEVEL[context.readiness.level];
  return (
    <section className="ui-card pcm-before" aria-labelledby="cmp-before-title" data-testid="composer-before">
      <div className="ui-card__head">
        <h2 id="cmp-before-title">{s ? `Before you post in r/${s.name}` : "Before you write"}</h2>
        {s ? (
          <span className="ui-chip" data-tone={tone} data-testid="composer-readiness" data-level={context.readiness.level}>
            {label}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="ui-t-sm pcm-warn" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !s ? <p className="ui-t-sm ui-muted">Reading r/{sub}&apos;s rules…</p> : null}
      {!s && !loading && !error ? <p className="ui-t-sm ui-muted">Type a subreddit to see its rules.</p> : null}
      {s ? (
        <div className="ui-stack">
          <p className="ui-t-sm">
            <b>Account:</b> {[context.account.username ? `u/${context.account.username}` : "", accountLine(context.account, s.name)].filter(Boolean).join(" · ") || "not added yet"}
          </p>
          {context.readiness.level === "unknown" ? (
            <p className="ui-t-sm ui-muted">
              Add your karma and account age in <Link href="/app/settings#settings-reddit">Settings</Link> (as on your Reddit profile) to see if r/{s.name} will let the post through.
            </p>
          ) : null}
          {context.readiness.reasons.length ? (
            <ul className="pcm-reasons" data-testid="composer-reasons">
              {context.readiness.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          {s.summary ? <p className="ui-t-sm">{s.summary}</p> : null}
          {/* Folded, so Title and Body stay on screen (2026-11-28: eleven rules pushed them below the fold). The summary
              names the limits that decide whether the post stays up. */}
          {s.rules.length || s.submitText || s.guide.avoid.length || s.guide.use.length ? (
            <details className="ui-disclosure pcm-rules" open={s.rules.length <= 4}>
              <summary data-testid="composer-rules-summary">
                <span>
                  <b>Rules of r/{s.name}</b> · {rulesSummary(s)}
                </span>
              </summary>
              <div className="ui-stack">
                {s.rules.length ? (
                  <ol data-testid="composer-rules">
                    {s.rules.map((r) => (
                      <li key={r.n} value={r.n}>
                        <b>{r.title}</b>
                        {r.text ? <div className="ui-t-xs ui-muted">{r.text}</div> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {s.submitText ? (
                  <div>
                    <p className="ui-label">What r/{s.name} asks before you post</p>
                    <p className="ui-t-xs ui-muted pcm-pre">{s.submitText}</p>
                  </div>
                ) : null}
                {s.guide.avoid.length || s.guide.use.length ? (
                  <div className="pcm-guide">
                    {s.guide.avoid.length ? (
                      <div>
                        <p className="ui-label">Avoid</p>
                        <ul>
                          {s.guide.avoid.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {s.guide.use.length ? (
                      <div>
                        <p className="ui-label">Use</p>
                        <ul>
                          {s.guide.use.map((u) => (
                            <li key={u}>{u}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
          <p className="ui-t-xs ui-subtle">
            Rules read {new Date(s.readAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. Following them makes removal less likely; nothing guarantees a post stays up.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function IssueList({ issues, onApply, onIgnore }: { issues: ComposeIssue[]; onApply: (i: ComposeIssue) => void; onIgnore: (i: ComposeIssue) => void }) {
  if (!issues.length) return null;
  return (
    <ul className="pcm-issues" aria-label="What to fix" data-testid="composer-issues">
      {issues.map((i) => (
        <li key={issueKey(i)} className="pcm-issue" data-severity={i.severity} data-source={i.source} data-testid="composer-issue">
          <div className="pcm-issue__head">
            <span className="ui-chip" data-tone={i.severity === "block" ? "danger" : "warn"}>{i.severity === "block" ? "Fix" : "Check"}</span>
            <b>{i.rule}</b>
            {i.source === "ai" ? <span className="ui-muted">· AI check</span> : null}
          </div>
          {i.quote ? <q className="pcm-quote">{i.quote}</q> : null}
          <div className="ui-muted">{i.why}</div>
          {i.suggestion ? (
            <div className="pcm-suggest">
              Try: <span>{i.suggestion}</span>
            </div>
          ) : null}
          {i.source === "ai" ? (
            <div className="ui-row">
              {i.suggestion && i.quote ? (
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onApply(i)} data-testid="composer-apply">
                  Apply
                </button>
              ) : null}
              <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={() => onIgnore(i)} data-testid="composer-ignore">
                Ignore
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

type Run = { id: string; status: string; error: string | null; output: unknown };

/** The run's output if it has the check's shape; anything else is treated as a failed check, never shown raw. */
function checkOutput(output: unknown): ComposeCheckOutput | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Partial<ComposeCheckOutput>;
  if ((o.verdict !== "ok" && o.verdict !== "fix") || !Array.isArray(o.issues)) return null;
  const issues = o.issues.filter(
    (i): i is ComposeIssue =>
      !!i && typeof i === "object" && typeof i.quote === "string" && (i.field === "title" || i.field === "body") && typeof i.rule === "string" && (i.severity === "block" || i.severity === "warn") && typeof i.why === "string",
  );
  return { verdict: o.verdict, summary: typeof o.summary === "string" ? o.summary : "", issues: issues.map((i) => ({ ...i, source: "ai", suggestion: typeof i.suggestion === "string" ? i.suggestion : null })) };
}

export function Composer() {
  const [sample, setSample] = useState(false);
  const [platform, setPlatform] = useState<ComposePlatform>("reddit");
  const [subInput, setSubInput] = useState("");
  const [sub, setSub] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [context, setContext] = useState<ComposerContext>(() => localContext("reddit"));
  const [loading, setLoading] = useState(false);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [userNote, setUserNote] = useState<string | null>(null);
  const [aiIssues, setAiIssues] = useState<ComposeIssue[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [checkStep, setCheckStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // Set with the start values in one batch: the draft effect waits for it, so it never loads or saves under the
  // defaults from before the address was read (which would swap out the text a draft card passed in).
  const [booted, setBooted] = useState(false);
  // The platform and sub the shown draft belongs to: a change of either swaps in that one's saved draft.
  const lastKey = useRef(draftKey("reddit", ""));
  const asked = useRef(0);
  // The draft a check was started for: its results show only on that draft.
  const checkedKey = useRef<string | null>(null);

  // The page's start: `?platform=x&sub=SaaS&text=…` (a draft card's "Open in Composer", Sales' "Write it yourself").
  // The text is read once and taken out of the address, so a reload does not paste it over what the founder wrote.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const isSample = q.get("sample") === "1";
    setSample(isSample);
    const p = q.get("platform");
    const start: ComposePlatform = (COMPOSE_PLATFORMS as readonly string[]).includes(p ?? "") ? (p as ComposePlatform) : "reddit";
    const s = cleanSub(q.get("sub") ?? "");
    const startSub = SUB_NAME.test(s) ? s : "";
    lastKey.current = draftKey(start, startSub);
    setBooted(true);
    setPlatform(start);
    setSubInput(startSub);
    setSub(startSub);
    const text = q.get("text");
    const saved = loadDraft(draftKey(start, startSub));
    if (text) {
      setBody(text.slice(0, 40_000));
      setTitle("");
      q.delete("text");
      window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}`);
    } else if (saved) {
      setTitle(saved.title);
      setBody(saved.body);
    }
    if (isSample) setProducts(["Ferreto"]);
    else
      void createClient()
        .from("marketing_documents_latest")
        .select("body")
        .eq("kind", "product")
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          const name = (data as { body?: { name?: unknown } } | null)?.body?.name;
          if (typeof name === "string" && name.trim()) setProducts([name.trim()]);
        });
  }, []);

  // The draft follows the platform and the sub it is written for.
  const key = draftKey(platform, sub);
  useEffect(() => {
    if (!booted) return;
    if (lastKey.current !== key) {
      // Save what is in the editor under the key it was written for, then load the new key's draft. A new key with no
      // draft keeps the text (review 2026-11-25: typing a sub cleared a post written before it).
      saveDraft(lastKey.current, title, body);
      lastKey.current = key;
      const saved = loadDraft(key);
      if (saved && (saved.title || saved.body)) {
        setTitle(saved.title);
        setBody(saved.body);
      }
      setAiIssues([]);
      setAiSummary(null);
      return;
    }
    const t = setTimeout(() => saveDraft(key, title, body), 400);
    return () => clearTimeout(t);
  }, [booted, key, title, body]);

  // The sub is read when the founder pauses typing (900 ms), leaves the field or presses Enter: not on every key, as
  // each new sub may cost a provider read (review 2026-11-25), and not only on blur, which left the rules unread while
  // the founder went straight to the title (2026-11-28).
  function commitSub() {
    const s = cleanSub(subInput);
    if (s === "" || SUB_NAME.test(s)) setSub(s);
  }
  useEffect(() => {
    if (!booted) return;
    const t = setTimeout(() => {
      const s = cleanSub(subInput);
      if (s === "" || SUB_NAME.test(s)) setSub(s);
    }, 900);
    return () => clearTimeout(t);
  }, [booted, subInput]);

  const loadContext = useCallback(async () => {
    if (platform !== "reddit") {
      setContext((was) => localContext(platform, was.account));
      setCtxError(null);
      return;
    }
    if (!sub) {
      setContext((was) => localContext("reddit", was.account));
      setCtxError(null);
      if (sample) return;
      // The account saved in Settings › Reddit, before any sub is typed (2026-11-28: the username stayed empty until a
      // sub's rules loaded). Without a sub the route reads only the profile: no provider, no credit.
      const ask = ++asked.current;
      try {
        const ctx = await api<ComposerContext>(`/composer/context?${new URLSearchParams({ platform: "reddit" })}`);
        if (ask !== asked.current) return;
        setContext((was) => ({ ...was, account: ctx.account }));
        setUserInput((u) => u || ctx.account.username || "");
      } catch {
        // Not read: the field stays empty for the founder to fill, as before.
      } finally {
        if (ask === asked.current) setLoading(false);
      }
      return;
    }
    if (sample) {
      setContext(sampleContext("reddit", sub));
      setUserInput((u) => u || "my_handle");
      return;
    }
    setLoading(true);
    setCtxError(null);
    // Only the newest request lands: an older answer for another sub never replaces it.
    const ask = ++asked.current;
    try {
      const ctx = await api<ComposerContext>(`/composer/context?${new URLSearchParams({ platform, subreddit: sub })}`);
      if (ask !== asked.current) return;
      setContext(ctx);
      setUserInput((u) => u || ctx.account.username || "");
    } catch (err) {
      if (ask !== asked.current) return;
      setContext((was) => localContext("reddit", was.account));
      setCtxError(err instanceof ApiError && err.status === 404 ? `r/${sub} was not found.` : err instanceof Error ? err.message : "Reddit did not answer. Try again in a minute.");
    } finally {
      if (ask === asked.current) setLoading(false);
    }
  }, [platform, sub, sample]);
  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  async function saveUsername() {
    const u = cleanUser(userInput);
    if (u === (context.account.username ?? "")) return;
    if (u && !USERNAME.test(u)) {
      setUserNote("A Reddit username is 3 to 20 letters, numbers, - or _.");
      return;
    }
    setUserNote(null);
    if (sample) {
      setUserNote("Saved.");
      return;
    }
    try {
      // Karma and account month go with it: the save writes all three (review 2026-11-25).
      const a = context.account;
      await api<AccountContext>("/composer/account", jsonBody({ username: u, karma: a.karma, accountCreatedAt: a.accountCreatedAt ? a.accountCreatedAt.slice(0, 7) : null }, "PUT"));
      setUserNote("Saved.");
      void loadContext();
    } catch (err) {
      setUserNote(err instanceof Error ? err.message : "Could not save. Try again.");
    }
  }

  // Live checks, every change, in code: no credits, no network.
  const codeIssues = useMemo(() => liveCheck({ platform, title, body, context, products }), [platform, title, body, context, products]);
  // AI issues stay only while their sentence is still in the post: an edited or applied sentence drops its issue.
  const shownAi = aiIssues.filter((i) => !ignored.has(issueKey(i)) && (i.field === "title" ? title : body).includes(i.quote));
  const issues = [...shownAi, ...codeIssues];
  const blocks = issues.filter((i) => i.severity === "block").length;

  // The check being followed (Realtime, with useLive's poll as the fallback); the row is read again under RLS.
  const active = run !== null && (run.status === "queued" || run.status === "running");
  const runRef = useRef(run);
  runRef.current = run;
  const refreshRun = useCallback(async (id?: string) => {
    const target = id ?? runRef.current?.id;
    if (!target) return;
    const { data } = await createClient().from("cmo_runs").select("id, status, error, output").eq("id", target).maybeSingle();
    if (!data) return;
    const next = data as Run;
    setRun(next);
    if (next.status === "done") {
      if (checkedKey.current !== lastKey.current) return;
      const out = checkOutput(next.output);
      if (!out) {
        setCheckError("The check did not come back readable. Try it again.");
        return;
      }
      setAiIssues(out.issues);
      setAiSummary(out.summary || (out.verdict === "ok" ? "Nothing to fix against these rules." : null));
      setIgnored(new Set());
    } else if (next.status === "failed") setCheckError(next.error ?? "The check failed. Your credit is refunded.");
  }, []);
  useLive("cmo_runs", active ? `id=eq.${run!.id}` : null, () => void refreshRun(), active, true, "composer");

  const input = { platform, ...(platform === "reddit" ? { subreddit: sub, title } : {}), body };
  const inputBytes = new TextEncoder().encode(JSON.stringify(input)).length;
  const canCheck = body.trim().length > 0 && (platform !== "reddit" || (sub !== "" && context.subreddit !== null)) && inputBytes <= CHECK_INPUT_MAX && body.trim().length <= CHECK_BODY_MAX;

  async function startCheck() {
    setCheckStep("busy");
    setCheckError(null);
    if (sample) {
      const out = sampleCheck(body);
      setAiIssues(out.issues.map((i) => ({ ...i, source: "ai" })));
      setAiSummary(out.summary);
      setIgnored(new Set());
      setCheckStep("idle");
      return;
    }
    try {
      checkedKey.current = lastKey.current;
      const started = await api<{ id: string; status: string }>("/cmo/runs", jsonBody({ kind: "compose_check", input }));
      setRun({ id: started.id, status: started.status, error: null, output: null });
      setCheckStep("idle");
      // A fast check may be done before Realtime subscribes: read it once now.
      void refreshRun(started.id);
    } catch (err) {
      setCheckStep("confirm");
      setRun(null);
      if (isPlanRequired(err)) {
        setCheckStep("idle");
        setPlanFor("check your post");
        return;
      }
      setCheckError(err instanceof Error ? err.message : "Could not start the check. Please try again.");
    }
  }
  function apply(i: ComposeIssue) {
    if (!i.suggestion || !i.quote) return;
    // A function, so "$" in a suggestion is text, not a replacement pattern.
    if (i.field === "title") setTitle((t) => t.replace(i.quote, () => i.suggestion!).slice(0, REDDIT_TITLE_MAX));
    else setBody((b) => b.replace(i.quote, () => i.suggestion!));
    // Applied is decided: a suggestion that keeps the sentence in it must not leave the issue standing.
    ignore(i);
  }
  function ignore(i: ComposeIssue) {
    setIgnored((s) => new Set(s).add(issueKey(i)));
  }

  async function copyAndOpen() {
    const target = openTarget(platform, sub, title, body);
    const text = platform === "reddit" ? `${title}\n\n${body}` : body;
    // The copy starts first, while this page has focus, and the tab opens in the same click (a late open is blocked).
    setCopyFailed(false);
    const copying = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"));
    window.open(target.url, "_blank", "noopener,noreferrer");
    try {
      await copying;
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
    }
  }

  const profile = platform === "reddit" ? null : profileOf(platform);
  const where = platform === "reddit" ? (sub ? `r/${sub}` : "the sub") : LABEL[platform];
  const target = openTarget(platform, sub || "", title, body);
  const canOpen = body.trim().length > 0 && (platform !== "reddit" || (sub !== "" && title.trim().length > 0));

  return (
    <div className="ui-post pcm" data-testid="v2-composer">
      <main className="pcm-main">
        <PageHeader
          title="Post composer"
          status={`You write the post. Ferreto checks it against ${platform === "reddit" ? "the sub's rules" : `${LABEL[platform]}'s norms`} and flags lines that read as AI. You post it from your own account.`}
          actions={
            <>
              {sample ? <span className="ui-chip">Sample data</span> : null}
              <Link href="/app/writer" className="ui-btn ui-btn--ghost">
                Posts
              </Link>
            </>
          }
        />

        <div className="pcm-toolbar">
          <span role="group" aria-label="Write for" className="ui-seg pcm-platforms">
            {COMPOSE_PLATFORMS.map((p) => (
              <button key={p} type="button" aria-pressed={platform === p} onClick={() => setPlatform(p)} data-testid={`composer-platform-${p}`} aria-label={LABEL[p]} title={LABEL[p]}>
                <PlatformBadge platform={p} size={18} />
              </button>
            ))}
          </span>
          {platform === "reddit" ? (
            <span className="pcm-who">
              <label className="pcm-inline">
                <span aria-hidden="true">r/</span>
                <input type="text" value={subInput} onChange={(e) => setSubInput(e.target.value)} onBlur={commitSub} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitSub(); } }} placeholder="SaaS" aria-label="Subreddit" maxLength={24} data-testid="composer-sub" />
              </label>
              <label className="pcm-inline">
                <span aria-hidden="true">u/</span>
                <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)} onBlur={() => void saveUsername()} placeholder="your_username" aria-label="Your Reddit username" maxLength={24} data-testid="composer-username" />
              </label>
              {userNote ? (
                <span className="ui-t-xs ui-muted" role="status">
                  {userNote}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>

        {platform === "reddit" ? <BeforeYouWrite context={context} sub={sub} loading={loading} error={ctxError} /> : (
          <section className="ui-card pcm-before" data-testid="composer-before">
            <div className="ui-card__head">
              <h2>{LABEL[platform]}</h2>
            </div>
            {profile ? <p className="ui-t-sm">{profile.tone}</p> : null}
            <p className="ui-t-xs ui-muted">
              Up to {profile?.limit.toLocaleString("en-US")} characters, no hashtags, the link in a reply. Your daily drafts stay in <Link href="/app/writer">Posts</Link>; open one here to rework it.
            </p>
          </section>
        )}

        {platform === "reddit" ? (
          <Editor id="composer-title" label="Title" value={title} onChange={setTitle} issues={issues.filter((i) => i.field === "title")} rows={1} maxLength={REDDIT_TITLE_MAX + 50} single />
        ) : null}
        <Editor id="composer-body" label={platform === "reddit" ? "Body" : "Post"} value={body} onChange={setBody} issues={issues.filter((i) => i.field === "body")} rows={platform === "reddit" ? 14 : 9} />
        <div className="pcm-count ui-t-xs ui-muted ui-num" data-testid="composer-count">
          {platform === "reddit" ? `Title ${title.length}/${REDDIT_TITLE_MAX} · ` : ""}
          {body.length.toLocaleString("en-US")}
          {profile ? `/${profile.limit.toLocaleString("en-US")}` : ""} characters
          {issues.length ? ` · ${issues.length} to look at${blocks ? `, ${blocks} to fix` : ""}` : body ? " · nothing flagged" : ""}
        </div>

        <div className="pcm-actions">
          {active ? (
            <span className="ui-chip ui-chip--dot" data-tone="accent">
              Checking against {where}…
            </span>
          ) : checkStep === "idle" ? (
            <button type="button" className="ui-btn ui-btn--ghost" disabled={!canCheck} onClick={() => setCheckStep("confirm")} data-testid="composer-check" title={inputBytes > CHECK_INPUT_MAX ? "The check reads posts up to about 3,800 characters" : undefined}>
              Check against {platform === "reddit" ? `${where} rules` : `${LABEL[platform]}'s norms`} · {CHECK_CREDITS} {CHECK_CREDITS === 1 ? "credit" : "credits"}
            </button>
          ) : (
            <span className="pcm-confirm" role="group" aria-label="Confirm the check">
              <span className="ui-t-xs ui-muted" data-testid="composer-check-cost">
                One AI pass flags sentences against {platform === "reddit" ? `${where}'s rules` : `${LABEL[platform]}'s norms`} and no-AI-slop. {costLine(CHECK_CREDITS)}
              </span>
              <button type="button" className="ui-btn ui-btn--quiet" disabled={checkStep === "busy"} onClick={() => setCheckStep("idle")}>
                Cancel
              </button>
              <button type="button" className="ui-btn ui-btn--primary" disabled={checkStep === "busy"} onClick={() => void startCheck()} data-testid="composer-check-start">
                {checkStep === "busy" ? "Starting…" : "Check it"}
              </button>
            </span>
          )}
          <button type="button" className="ui-btn ui-btn--primary" disabled={!canOpen} onClick={() => void copyAndOpen()} data-testid="composer-open">
            {copied ? "Copied · page opened" : target.label}
          </button>
        </div>
        {inputBytes > CHECK_INPUT_MAX || body.trim().length > CHECK_BODY_MAX ? <p className="ui-t-xs ui-muted">The AI check reads posts up to 3,000 characters. The code checks above still run.</p> : null}
        {copyFailed ? (
          <p className="ui-t-sm pcm-warn" role="alert" data-testid="composer-copy-failed">
            The text was not copied. Select it above, copy it, then paste it on the page that opened.
          </p>
        ) : null}
        {checkError ? (
          <p className="ui-t-sm pcm-warn" role="alert">
            {checkError}
          </p>
        ) : null}
        {blocks && canOpen ? <p className="ui-t-xs ui-muted">Lines marked Fix are likely to get the post removed. You decide what goes out.</p> : null}
      </main>

      <aside className="pcm-side" aria-label="Checks">
        <section className="ui-card">
          <div className="ui-card__head">
            <h2>What to look at</h2>
            {issues.length ? <span className="ui-chip ui-num">{issues.length}</span> : null}
          </div>
          {aiSummary ? (
            <p className="ui-t-sm" data-testid="composer-ai-summary">
              {aiSummary}
            </p>
          ) : null}
          {issues.length ? <IssueList issues={issues} onApply={apply} onIgnore={ignore} /> : <p className="ui-t-sm ui-muted">{body ? "Nothing flagged so far." : "Checks show here as you write."}</p>}
        </section>
      </aside>
      <PlanSheet open={planFor !== null} onClose={() => setPlanFor(null)} action={planFor ?? undefined} />
    </div>
  );
}
