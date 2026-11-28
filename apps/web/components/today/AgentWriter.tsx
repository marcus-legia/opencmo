"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AllowanceBanner, FreeLockedCard, useUsageState } from "@/components/billing/UsageNotice";
import { ApprovalCard } from "@/components/cards/ApprovalCard";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { PLATFORM_LABEL as SOURCE_LABEL } from "@/lib/cmo/social/conversations";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import type { WriterScreen } from "@/lib/screens/writer";
import { formatWhen, fromLocalInput, localMonday, toLocalInput } from "@/lib/time-zone";

import { PostViews } from "./CalendarView";
import { KIND_ICON, PLATFORM_ICON } from "./cards";
import { PageHeader } from "./PageHeader";
import { PlatformBadge, PlatformMark, hasLogo } from "./platform-logos";
import { whereSaid } from "./LibraryView";
import { useDecide } from "./useDecide";
import { POST_SECTIONS, dayLabel, draftsLeftOver, draftsThisWeek, postSections } from "./week";

type Draft = WriterScreen["drafts"][number];
type Tab = "posts" | "voice";

const KIND_LABEL: Record<Draft["kind"], string> = { post: "post", caption: "Caption" };
/** A state's words and its chip tone (`.ui-chip[data-tone]`): the accent marks what waits on the founder. */
type Tone = "accent" | "ok" | "warn" | undefined;
const BADGE: Record<Draft["column"], [string, Tone]> = { planned: ["Planned", undefined], waiting: ["Waiting", "accent"], drafting: ["Drafting", undefined], scheduled: ["Scheduled", "ok"], posted: ["Posted", "ok"] };
// The chat passes the platform on to the writer (`create_task` post_platform): X, LinkedIn and Threads (owner, 2026-11-23).
const ASK_KINDS = [
  { id: "post", label: "X post", prompt: "Write an X post" },
  { id: "linkedin", label: "LinkedIn post", prompt: "Write a LinkedIn post" },
  { id: "threads", label: "Threads post", prompt: "Write a Threads post" },
] as const;

/**
 * The one instant a row stands for: when it went or goes out, else the time its waiting card proposes. The list and
 * the "This week" box both read it, in the profile's zone, so they never name two different days (bug 3, 2026-11-28:
 * the box said "FRI" from the plan's day while the list said "Sat 04:00" from the card, in the browser's zone).
 */
const instantOf = (d: Draft, card: Card | undefined): string | null => d.at ?? (card?.body.kind === "post" ? (card.body.proposed?.at ?? null) : null);
const zoned = (iso: string, timezone: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", ...opts }).format(new Date(iso));
/** "Sat 04:00" in the founder's zone, else the plan's day ("Fri", "Mon 16 Nov"). */
const whenOf = (d: Draft, card: Card | undefined, timezone: string) => {
  const at = instantOf(d, card);
  return at ? zoned(at, timezone, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : (dayLabel(d) ?? "");
};
/** A waiting draft whose card is not in the queue says why: held past the day's budget, or no card at all. */
const badgeOf = (d: Draft): [string, Tone] =>
  d.column === "waiting" && d.cardState === "held" ? ["Held", undefined]
  : d.column === "waiting" && d.cardState === "missing" ? ["No card", undefined]
  // An approved post with no connected account never goes out on its own (owner, 2026-11-24).
  : d.column === "scheduled" && d.connected === false ? ["Post it yourself", "warn"]
  : BADGE[d.column];
/** "Open in Composer" (2026-11-25): a post draft for X, Threads or LinkedIn opens there with its words, to rework by hand. */
const COMPOSE_PLATFORMS = new Set(["x", "threads", "linkedin"]);
function composeHref(d: Draft, card: Card | undefined): string | null {
  if (d.kind !== "post" || !COMPOSE_PLATFORMS.has(d.platform)) return null;
  const tab = card?.body.kind === "post" ? (card.body.platforms.find((p) => p.platform === d.platform) ?? card.body.platforms[0]) : undefined;
  const text = tab?.versions[0] ?? d.text ?? "";
  if (!text.trim()) return null;
  return `/app/compose?${new URLSearchParams({ platform: d.platform, text })}`;
}
const kindOf = (d: Draft) => (d.kind === "post" ? `${PLATFORM_LABEL[d.platform]} post` : KIND_LABEL[d.kind]);
const iconOf = (d: Draft) => (d.kind === "caption" ? KIND_ICON.price : (PLATFORM_ICON[d.platform] ?? KIND_ICON.post));

/**
 * The Writer agent page (AgentWriter.dc.html). Asking for a post goes through the CMO chat, which shows its price card
 * before anything runs (charge before running). A waiting row opens its real card in place; an approved script offers
 * the phone prompter and the editor.
 */
type Source = NonNullable<Draft["sources"]>[number];

/** "Based on 3 conversations · Reddit, Hacker News": what a post is written from, at a glance in the list. */
export function basedOn(sources: readonly Source[]): string {
  const where = [...new Set(sources.map((s) => SOURCE_LABEL[s.platform]))].join(", ");
  return `Based on ${sources.length} ${sources.length === 1 ? "conversation" : "conversations"} · ${where}`;
}

/**
 * The conversations an open draft is written from: each one's summary and a link to its thread, named by where it was
 * said (never the thread's title), so the founder can read it again before posting.
 */
function SourceList({ sources }: { sources: readonly Source[] }) {
  return (
    <section aria-label="What this post is based on" data-testid="writer-sources" className="pw-sources">
      <p className="ui-t-xs ui-muted">
        Written from {sources.length === 1 ? "this conversation" : `these ${sources.length} conversations`} in your <Link href="/app/library">Library</Link>
      </p>
      <ul>
        {sources.map((s) => (
          <li key={s.opportunityId} data-testid="writer-source">
            {hasLogo(s.platform) ? <PlatformMark platform={s.platform} size={14} /> : null}
            <span className="pw-sources__text">
              {s.summary}{" "}
              {/* The scan reference ("3.1") is the way back to the person on Sales; the words around it were noise. */}
              {s.ref ? (
                <a className="ui-muted" href={`/app/sales#thread-${s.opportunityId}`} data-testid="writer-source-sales" title={`From Scan #${s.ref.split(".")[0]}`}>
                  #{s.ref}
                </a>
              ) : null}{" "}
              {s.url ? (
                <a className="ui-muted" href={s.url} target="_blank" rel="noopener noreferrer" data-testid="writer-source-link" >
                  {whereSaid(s)} ↗
                </a>
              ) : (
                <span className="ui-muted">{whereSaid(s)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentWriter() {
  const [state, reload] = useScreen("writer");
  const [dash, reloadCards] = useScreen("dashboard");
  const usageState = useUsageState();
  const { focusChat, toast } = useShellState();
  const [showing, setShowing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  const [open, setOpen] = useState<string | null>(null);
  // A link from Sales ("Used in Post #14", `#post-<id>`) opens that post once the list is in (2026-11-25).
  const linked = useRef(false);
  const [linkGone, setLinkGone] = useState(false);
  const loadedIds = state.status === "ready" ? state.data.drafts.map((d) => d.id).join() : null;
  useEffect(() => {
    if (linked.current || loadedIds === null) return;
    const id = window.location.hash.match(/^#post-([0-9a-f-]{36})$/i)?.[1];
    if (!id) return;
    linked.current = true;
    setTab("posts");
    // Writer lists the last two weeks: an older post linked from Sales says so instead of doing nothing.
    if (!loadedIds.split(",").includes(id)) {
      setLinkGone(true);
      return;
    }
    setPlatform(null);
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`post-${id}`)?.scrollIntoView({ block: "start" }));
  }, [loadedIds]);
  // An approved post's time opens under its row, from the "Scheduled" button on the row itself (owner, 2026-11-26).
  const [timing, setTiming] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [askKind, setAskKind] = useState<(typeof ASK_KINDS)[number]["id"]>("post");
  // The platforms this week's drafts are for: a chip each (as the Calendar's), when there is more than one.
  const [platform, setPlatform] = useState<string | null>(null);
  const data = state.status === "ready" ? state.data : null;
  const queue = dash.status === "ready" ? ((dash.data as { queue: Card[] }).queue ?? []) : [];
  const sample = !(dash.status === "ready" && (dash.live as { queue?: boolean }).queue);
  const onDecide = useDecide(sample, () => {
    reload();
    reloadCards();
  });

  const timezone = data?.timezone ?? "UTC";
  const liveDrafts = state.status === "ready" && state.live.drafts;
  const drafts = data?.drafts ?? [];
  const waiting = drafts.filter((d) => d.column === "waiting");
  // Held past the day's ten new cards: the founder's turn tomorrow unless they show it now.
  const held = waiting.filter((d) => d.cardState === "held").length;
  // In review with no live card (cancelled, never raised again): not on Today until the founder asks for it.
  const lost = waiting.filter((d) => d.cardState === "missing").length;
  const approved = draftsThisWeek(drafts).filter((d) => d.column === "scheduled" || d.column === "posted").length;
  const platforms = [...new Set(drafts.map((d) => d.platform))];
  // "This week" is this week's drafts by their day; older ones still open show apart, under "From last week".
  const thisWeek = draftsThisWeek(drafts);
  // A filter whose chips are gone (one platform left, or the chosen one no longer has drafts) no longer applies.
  const active = platform && platforms.length > 1 && platforms.includes(platform as Draft["platform"]) ? platform : null;
  const byPlatform = (list: Draft[]) => (active ? list.filter((d) => d.platform === active) : list);
  // The index (owner, 2026-11-25): New drafts, Approved, Posted, Planned, each post numbered.
  const sections = postSections(byPlatform(drafts));
  // Last week's drafts nobody decided sit in New drafts, marked, so the founder approves or skips them.
  const lastWeek = new Set(draftsLeftOver(drafts).map((d) => d.id));
  const firstOpen = open ?? waiting.find((d) => d.approvalId)?.id ?? waiting[0]?.id ?? null;
  // The side card: this week's first seven, in the order they go out.
  const week = thisWeek.slice(0, 7);
  const askPrompt = ASK_KINDS.find((k) => k.id === askKind)!;

  /** Brings a held or lost card into the queue (`approval_show_now`), then reloads so it opens in place. */
  async function showNow(d: Draft) {
    if (!d.ref || showing) return;
    setShowing(d.id);
    try {
      await api("/approvals/show-now", jsonBody({ refKind: d.ref.kind, refId: d.ref.id }));
      setOpen(d.id);
      reload();
      reloadCards();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "That did not go through. Please try again.");
    } finally {
      setShowing(null);
    }
  }

  /** Moves an approved post to another time (`change_time`): the slot asks again on a new card, as the Calendar does. */
  async function move(d: Draft, publishAt: string) {
    if (!d.slotId || saving) return;
    if (!liveDrafts) {
      toast("Sample posts: nothing was moved.");
      return;
    }
    setSaving(d.id);
    try {
      await api(`/schedule/slots/${encodeURIComponent(d.slotId)}`, jsonBody({ action: "change_time", publishAt }));
      toast("New time saved. A new card asks you to approve it.");
      setTiming(null);
      reload();
      reloadCards();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Could not move it. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  function write() {
    focusChat();
    fillChat(`${askPrompt.prompt}${ask.trim() ? `: ${ask.trim()}` : "."}`);
    setAsk("");
  }

  const cardOf = (d: Draft) => (d.approvalId ? queue.find((c) => c.id === d.approvalId) : undefined);
  const statusLine = data
    ? [
        `${waiting.length - held - lost} waiting for your OK`,
        held ? `${held} held until tomorrow` : null,
        lost ? `${lost} without a card` : null,
        `${approved} approved this week`,
      ]
        .filter(Boolean)
        .join(" · ")
    : state.status === "loading"
      ? "Loading…"
      : null;

  const renderRow = (d: Draft) => {
    const card = cardOf(d);
    // A waiting draft always opens: its card, or (held, lost, or not loaded yet) its words and "Show it now".
    const opens = Boolean(card) || d.column === "waiting";
    const [badge, tone] = badgeOf(d);
    const isOpen = opens && firstOpen === d.id;
    // An approved post's state is also the way to its time: the chip is a button, and opens the row's schedule panel.
    const schedules = d.column === "scheduled" && Boolean(d.at);
    const timingOpen = timing === d.id;
    const compose = composeHref(d, card);
    return (
      <div key={d.id} className="ui-card ui-card--flush pw-row" data-active={isOpen || timingOpen || undefined} data-open={isOpen || timingOpen} data-testid="writer-row" data-platform={d.platform} id={`post-${d.id}`}>
        <div className="pw-row__head">
          <button type="button" className="pw-row__main" onClick={opens ? () => setOpen(isOpen ? "" : d.id) : undefined} aria-expanded={opens ? isOpen : undefined} data-static={opens ? undefined : ""}>
            <span className="pw-row__icon">{iconOf(d)}</span>
            <span className="pw-row__text">
              <span className="pw-row__title">
                {d.no ? (
                  <span className="pw-no ui-num" data-testid="writer-no">
                    #{d.no}
                  </span>
                ) : null}
                {/* The row's icon already shows the platform (28/11 redesign): the words stay for screen readers. */}
                <span className="v2-visually-hidden">{kindOf(d)}: </span>
                {d.title}
              </span>
              {lastWeek.has(d.id) && d.column === "waiting" ? (
                <span className="pw-row__meta" data-testid="writer-left-over">
                  From last week: approve or skip it
                </span>
              ) : null}
              {d.sources?.length ? (
                <span className="pw-row__meta pw-row__sources" data-testid="writer-based-on" title={basedOn(d.sources)}>
                  {[...new Set(d.sources.map((s) => s.platform))].map((p) =>
                    hasLogo(p) ? <PlatformMark key={p} platform={p} size={13} /> : null,
                  )}
                  <span className="v2-visually-hidden">{basedOn(d.sources)}</span>
                  <span aria-hidden="true">
                    {d.sources.length} {d.sources.length === 1 ? "source" : "sources"}
                  </span>
                </span>
              ) : null}
            </span>
          </button>
          <div className="pw-row__end">
            {schedules ? (
              <button type="button" className="ui-chip" data-tone={tone} aria-expanded={timingOpen} onClick={() => setTiming(timingOpen ? null : d.id)} data-testid="writer-schedule">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="18" height="18" x="3" y="4" rx="2" />
                  <path d="M16 2v4" />
                  <path d="M8 2v4" />
                  <path d="M3 10h18" />
                </svg>
                {badge}
              </button>
            ) : (
              <span className="ui-chip" data-tone={tone}>
                {badge}
              </span>
            )}
            {d.column === "scheduled" && d.postYourself?.length ? (
              <span className="pw-row__meta" data-testid="writer-post-yourself">
                post it yourself on {d.postYourself.map((p) => PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p).join(" and ")}
              </span>
            ) : null}
            {/* A waiting draft's card says when it would go out: the row shows that instant, in the founder's zone. */}
            <span className="pw-row__when ui-num">{whenOf(d, card, timezone)}</span>
          </div>
        </div>
        {timingOpen ? (
          <SchedulePanel draft={d} timezone={timezone} saving={saving === d.id} onMove={(at) => void move(d, at)} onClose={() => setTiming(null)} />
        ) : null}
        {isOpen && card ? (
          <div className="pw-detail td-cardhost">
            <ApprovalCard card={card} sample={sample} onDecide={onDecide} open />
            {d.sources?.length ? <SourceList sources={d.sources} /> : null}
            {compose ? (
              <Link className="ui-btn ui-btn--ghost ui-btn--sm pw-detail__compose" href={compose} data-testid="writer-open-composer">
                Open in Composer
              </Link>
            ) : null}
          </div>
        ) : null}
        {isOpen && !card && d.column === "waiting" ? (
          <div className="pw-detail" data-testid="writer-show-now">
            {d.text ? <p className="pw-post">{d.text}</p> : null}
            {d.sources?.length ? <SourceList sources={d.sources} /> : null}
            <p className="ui-t-sm ui-muted">
              {d.cardState === "held"
                ? `Held until ${d.heldUntil ? zoned(d.heldUntil, timezone, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "tomorrow"}: you get about ten new cards a day, so the rest wait for the next one.`
                : d.cardState === "missing"
                  ? "Its card is gone, so it is not on Today. Ask for the card again to approve or skip it."
                  : dash.status === "loading"
                    ? "Loading its card…"
                    : "Its card is not on Today yet."}
            </p>
            <div className="ui-row">
              {d.ref && (d.cardState === "held" || d.cardState === "missing") ? (
                <button type="button" className="ui-btn ui-btn--primary" disabled={showing === d.id} onClick={() => void showNow(d)}>
                  {showing === d.id ? "Bringing it in…" : d.cardState === "held" ? "Show it now" : "Ask for the card again"}
                </button>
              ) : null}
              {compose ? (
                <Link className="ui-btn ui-btn--ghost" href={compose} data-testid="writer-open-composer">
                  Open in Composer
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="ui-post pw" data-testid="v2-writer">
      <main className="pw-main">
        <PageHeader
          title="Posts"
          status={statusLine}
          platforms={[
            { id: "x", label: "X" },
            { id: "linkedin", label: "LinkedIn" },
            { id: "threads", label: "Threads" },
          ]}
          actions={<PostViews current="list" />}
        />

        <AllowanceBanner state={usageState} />
        <FreeLockedCard state={usageState} where="post" />

        <form
          className="ui-card pw-ask"
          onSubmit={(e) => {
            e.preventDefault();
            write();
          }}
        >
          <label htmlFor="ask-writer" className="ui-label">
            Ask for a post
          </label>
          <div className="pw-ask__row">
            <input id="ask-writer" className="ui-input" type="text" placeholder="What should it be about?" value={ask} onChange={(e) => setAsk(e.target.value)} />
            {/* Which platform, as the platforms' own icons: a toggle each instead of a select (owner, 2026-11-23). */}
            <span role="group" aria-label="Write for" className="ui-seg pw-ask__kinds">
              {ASK_KINDS.map((k) => (
                <button key={k.id} type="button" aria-pressed={askKind === k.id} onClick={() => setAskKind(k.id)} data-testid={`ask-kind-${k.id}`}>
                  <PlatformBadge platform={k.id === "post" ? "x" : k.id} size={16} />
                  {k.label.replace(/ post$/, "")}
                </button>
              ))}
            </span>
            <button type="submit" className="ui-btn ui-btn--primary">
              Write it
            </button>
          </div>
          <p className="ui-t-xs ui-muted pw-ask__note">
            Or{" "}
            <Link href="/app/compose" data-testid="writer-write-yourself">
              write it yourself
            </Link>
            : Ferreto checks each line against the platform&apos;s rules and for lines that read as AI. Reddit posts are written there.
          </p>
        </form>

        <div className="pw-bar">
          <div className="ui-tabs" role="tablist" aria-label="Writer">
            {(
              [
                ["posts", "Posts"],
                ["voice", "Voice"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab !== "voice" && platforms.length > 1 ? (
            <div role="group" aria-label="Platform" className="ui-row pw-bar__filter">
              {[null, ...platforms].map((p) => (
                <button key={p ?? "all"} type="button" className="ui-chip" aria-pressed={active === p} onClick={() => setPlatform(p)}>
                  {p ? PLATFORM_LABEL[p] : "All"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {state.status === "error" ? <p className="ui-t-sm ui-muted pw-gap">{state.message}</p> : null}

        {tab !== "voice" && data ? (
          <div className="ui-stack ui-stack--lg pw-gap">
            {linkGone ? (
              <p className="ui-t-sm ui-muted" role="status" data-testid="writer-link-gone">
                That post is older than two weeks, so it is not listed here.
              </p>
            ) : null}
            {drafts.length === 0 ? (
              <div className="ui-card ui-empty">
                <p className="ui-empty__title">No posts yet</p>
                <p>The week&apos;s posts are planned every Sunday from what people asked in Sales. Ask for one above to start now.</p>
              </div>
            ) : null}
            {drafts.length
              ? POST_SECTIONS.map(({ id, label, empty }) => (
                  <section key={id} className="pw-section" aria-label={label} data-testid={`writer-section-${id}`}>
                    <h2 className="pw-section__head">
                      <span>{label}</span>
                      <span className="ui-muted ui-num">{sections[id].length}</span>
                    </h2>
                    {sections[id].length ? (
                      <div className="pw-list">{sections[id].map(renderRow)}</div>
                    ) : (
                      <p className="ui-t-sm ui-subtle">{active ? `No ${PLATFORM_LABEL[active as Draft["platform"]]} posts here.` : empty}</p>
                    )}
                  </section>
                ))
              : null}
          </div>
        ) : null}

        {tab === "voice" && data ? (
          <section className="ui-card pw-gap">
            {data.voice.lines.length === 0 ? <p className="ui-t-sm ui-muted">Ferreto learns how you write from what you change in its drafts.</p> : null}
            <ul className="pw-voice">
              {data.voice.lines.map((line) => (
                <li key={line.text}>
                  <span>{line.text}</span>
                  <span className="ui-t-xs ui-subtle">{line.source}</span>
                </li>
              ))}
            </ul>
            <Link href="/app?doc=voice" className="ui-btn ui-btn--ghost">
              Edit your voice
            </Link>
          </section>
        ) : null}
      </main>

      <aside className="pw-side">
        <section className="ui-card" aria-labelledby="writer-week-title">
          <div className="ui-card__head">
            <h2 id="writer-week-title">This week</h2>
            <Link href="/app/schedule" className="ui-t-xs">
              Week view
            </Link>
          </div>
          {week.length === 0 ? <p className="ui-t-sm ui-muted">The week&apos;s plan lands here on Sunday.</p> : null}
          {week.length ? (
            <ul className="pw-week">
              {week.map((d) => {
                const card = cardOf(d);
                const at = instantOf(d, card);
                const done = d.column === "posted" || d.column === "scheduled";
                return (
                  <li key={d.id} data-testid="writer-week-day">
                    {/* The same instant as the row's, in the founder's zone: day and time, never the plan's day alone. */}
                    <span className="pw-week__when ui-num">{at ? zoned(at, timezone, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : (d.dayText ?? "").slice(0, 3)}</span>
                    <span className="pw-week__dot" data-done={done || undefined} aria-hidden="true"></span>
                    <span className="pw-week__what">{kindOf(d)}</span>
                    <span className="ui-t-xs ui-muted">{badgeOf(d)[0].toLowerCase()}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
        <section className="ui-card" aria-labelledby="writer-voice-title">
          <div className="ui-card__head">
            <h2 id="writer-voice-title">Your voice</h2>
          </div>
          <p className="ui-t-sm ui-muted">Ferreto learns how you write from what you change in its drafts.</p>
          {data?.voice.wordsCut.length ? (
            <div className="pw-side__group">
              <p className="ui-label">Words you cut</p>
              <div className="ui-row">
                {data.voice.wordsCut.map((w) => (
                  <span key={w} className="ui-chip pw-cut">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {data?.voice.lines.length ? (
            <div className="pw-side__group">
              <p className="ui-label">Rules it keeps</p>
              <ul className="pw-rules">
                {data.voice.lines.slice(0, 4).map((l) => (
                  <li key={l.text}>{l.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

/**
 * An approved post's time, under its row: when it goes out in the founder's zone, a picker that moves it
 * (`change_time`, which asks again on a new card, as the Calendar does), and the week it sits in.
 */
function SchedulePanel({ draft, timezone, saving, onMove, onClose }: { draft: Draft; timezone: string; saving: boolean; onMove: (at: string) => void; onClose: () => void }) {
  const initial = toLocalInput(draft.at!, timezone);
  const [value, setValue] = useState(initial);
  const at = fromLocalInput(value, timezone);
  const platform = PLATFORM_LABEL[draft.platform];
  return (
    <div className="pw-detail" data-testid="writer-schedule-panel">
      <p className="ui-t-sm">
        Goes out <b className="ui-num">{formatWhen(draft.at!, timezone)}</b> <span className="ui-muted">· {platform} · {timezone}</span>
      </p>
      {draft.connected === false ? (
        <p className="ui-t-sm ui-muted" data-testid="writer-not-connected">
          No {platform} account is connected, so this does not go out on its own. Post it yourself at this time, or connect {platform} and it goes out by itself.
        </p>
      ) : null}
      {draft.slotId ? (
        <div>
          <label className="ui-label" htmlFor={`writer-at-${draft.id}`}>
            New time ({timezone})
          </label>
          <input id={`writer-at-${draft.id}`} className="ui-input pw-time" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} data-testid="writer-time-input" />
          <p className="ui-t-xs ui-muted pw-time__note">Ferreto asks you to approve the new time before it goes out.</p>
        </div>
      ) : (
        <p className="ui-t-sm ui-muted">Its time is set in the calendar.</p>
      )}
      <div className="ui-row">
        {draft.slotId ? (
          <button type="button" className="ui-btn ui-btn--primary" disabled={saving || !at || value === initial} onClick={() => at && onMove(at)} data-testid="writer-save-time">
            {saving ? "Saving…" : "Save the time"}
          </button>
        ) : null}
        <Link className="ui-btn ui-btn--ghost" href={`/app/schedule?from=${localMonday(Date.parse(draft.at!), timezone)}`} data-testid="writer-in-calendar">
          See it in the calendar
        </Link>
        <button type="button" className="ui-btn ui-btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
