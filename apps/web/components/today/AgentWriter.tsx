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

import { KIND_ICON, PLATFORM_ICON } from "./cards";
import { PlatformBadge } from "./platform-logos";
import { whereSaid } from "./LibraryView";
import { PostViewSwitch } from "./TopBar";
import { useDecide } from "./useDecide";
import { POST_SECTIONS, dayLabel, draftsLeftOver, draftsThisWeek, postSections } from "./week";

type Draft = WriterScreen["drafts"][number];
type Tab = "posts" | "voice";

const KIND_LABEL: Record<Draft["kind"], string> = { post: "post", caption: "Caption" };
const BADGE: Record<Draft["column"], [string, string]> = { planned: ["Planned", "badge b-plan"], waiting: ["Waiting", "badge b-wait"], drafting: ["Drafting", "badge b-new"], scheduled: ["Scheduled", "badge b-ok"], posted: ["Posted", "badge b-ok"] };
// The chat passes the platform on to the writer (`create_task` post_platform): X, LinkedIn and Threads (owner, 2026-11-23).
const ASK_KINDS = [
  { id: "post", label: "X post", prompt: "Write an X post" },
  { id: "linkedin", label: "LinkedIn post", prompt: "Write a LinkedIn post" },
  { id: "threads", label: "Threads post", prompt: "Write a Threads post" },
] as const;

const when = (d: Draft) => {
  if (!d.at) return dayLabel(d) ?? "";
  const t = new Date(d.at);
  return `${t.toLocaleDateString("en-GB", { weekday: "short" })} ${t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
/** A waiting draft whose card is not in the queue says why: held past the day's budget, or no card at all. */
const badgeOf = (d: Draft): [string, string] =>
  d.column === "waiting" && d.cardState === "held" ? ["Held", "badge b-plan"]
  : d.column === "waiting" && d.cardState === "missing" ? ["No card", "badge b-plan"]
  // An approved post with no connected account never goes out on its own (owner, 2026-11-24).
  : d.column === "scheduled" && d.connected === false ? ["Post it yourself", "badge b-wait"]
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
    <section aria-label="What this post is based on" data-testid="writer-sources" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div className="meta" style={{ fontWeight: "500" }}>
        Based on {sources.length === 1 ? "this conversation" : `these ${sources.length} conversations`} in your <Link href="/app/library">Library</Link>
      </div>
      <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "4px" }}>
        {sources.map((s) => (
          <li key={s.opportunityId} data-testid="writer-source" style={{ fontSize: "13.5px" }}>
            {s.summary}{" "}
            {s.ref ? (
              <a className="idx-link" href={`/app/sales#thread-${s.opportunityId}`} data-testid="writer-source-sales">
                From Scan #{s.ref.split(".")[0]} · {s.ref}
              </a>
            ) : null}{" "}
            {s.url ? (
              <a className="meta" href={s.url} target="_blank" rel="noopener noreferrer" data-testid="writer-source-link">
                {whereSaid(s)} thread ↗
              </a>
            ) : (
              <span className="meta">{whereSaid(s)}</span>
            )}
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

  const renderRow = (d: Draft) => {
    const card = d.approvalId ? queue.find((c) => c.id === d.approvalId) : undefined;
    // A waiting draft always opens: its card, or (held, lost, or not loaded yet) its words and "Show it now".
    const opens = Boolean(card) || d.column === "waiting";
    const badge = badgeOf(d);
    const isOpen = opens && firstOpen === d.id;
    // An approved post's state is also the way to its time: the badge is a button, and opens the row's schedule panel.
    const schedules = d.column === "scheduled" && Boolean(d.at);
    const timingOpen = timing === d.id;
    return (
      <div key={d.id} className="th" data-open={isOpen || timingOpen} data-testid="writer-row" data-platform={d.platform} id={`post-${d.id}`}>
        <div className="thead">
          <button type="button" className="row" onClick={opens ? () => setOpen(isOpen ? "" : d.id) : undefined} aria-expanded={opens ? isOpen : undefined} style={opens ? undefined : { cursor: "default" }}>
            <span className="st">{iconOf(d)}</span>
            <span style={{ flex: "1 1 auto", minWidth: "0", display: "flex", flexDirection: "column" }}>
              <span className="ttl">
                {d.no ? (
                  <span className="idx-no" data-testid="writer-no">
                    #{d.no}
                  </span>
                ) : null}
                <span className="kind">{kindOf(d)} · </span>
                {d.title}
              </span>
              {lastWeek.has(d.id) && d.column === "waiting" ? (
                <span className="meta" data-testid="writer-left-over">
                  From last week: approve or skip it
                </span>
              ) : null}
              {d.sources?.length ? (
                <span className="meta" data-testid="writer-based-on" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {basedOn(d.sources)}
                  {d.sources.some((s) => s.ref) ? ` · From ${d.sources.flatMap((s) => (s.ref ? [`Scan #${s.ref.split(".")[0]} · ${s.ref}`] : [])).join(", ")}` : ""}
                </span>
              ) : null}
            </span>
          </button>
          <div className="rowend">
            {schedules ? (
              <button type="button" className={`${badge[1]} badge-btn`} aria-expanded={timingOpen} onClick={() => setTiming(timingOpen ? null : d.id)} data-testid="writer-schedule">
                <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                  <rect width="18" height="18" x="3" y="4" rx="2" />
                  <path d="M16 2v4" />
                  <path d="M8 2v4" />
                  <path d="M3 10h18" />
                </svg>
                {badge[0]}
              </button>
            ) : (
              <span className={badge[1]}>{badge[0]}</span>
            )}
            {d.column === "scheduled" && d.postYourself?.length ? (
              <span className="meta" data-testid="writer-post-yourself">
                post it yourself on {d.postYourself.map((p) => PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p).join(" and ")}
              </span>
            ) : null}
            <span className="meta" style={{ minWidth: "64px", textAlign: "right", whiteSpace: "nowrap" }}>
              {/* A waiting draft's card says when it would go out ("Mon 09:00"): the row shows that, not the planned day. */}
              {!d.at && card?.body.kind === "post" && card.body.proposed?.at ? when({ ...d, at: card.body.proposed.at }) : when(d)}
            </span>
          </div>
        </div>
        {timingOpen ? (
          <SchedulePanel draft={d} timezone={timezone} saving={saving === d.id} onMove={(at) => void move(d, at)} onClose={() => setTiming(null)} />
        ) : null}
        {isOpen && card ? (
          <div className="detail td-cardhost">
            <ApprovalCard card={card} sample={sample} onDecide={onDecide} open />
            {d.sources?.length ? <SourceList sources={d.sources} /> : null}
            {composeHref(d, card) ? (
              <Link className="meta" href={composeHref(d, card)!} data-testid="writer-open-composer">
                Open in Composer
              </Link>
            ) : null}
          </div>
        ) : null}
        {isOpen && !card && d.column === "waiting" ? (
          <div className="detail" data-testid="writer-show-now">
            {d.text ? <p className="post">{d.text}</p> : null}
            {d.sources?.length ? <SourceList sources={d.sources} /> : null}
            {composeHref(d, undefined) ? (
              <Link className="meta" href={composeHref(d, undefined)!} data-testid="writer-open-composer">
                Open in Composer
              </Link>
            ) : null}
            <div className="meta">
              {d.cardState === "held"
                ? `Held until ${d.heldUntil ? new Date(d.heldUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "tomorrow"}: you get about ten new cards a day, so the rest wait for the next one.`
                : d.cardState === "missing"
                  ? "Its card is gone, so it is not on Today. Ask for the card again to approve or skip it."
                  : dash.status === "loading"
                    ? "Loading its card…"
                    : "Its card is not on Today yet."}
            </div>
            {d.ref && (d.cardState === "held" || d.cardState === "missing") ? (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" className="primary" disabled={showing === d.id} onClick={() => void showNow(d)}>
                  {showing === d.id ? "Bringing it in…" : d.cardState === "held" ? "Show it now" : "Ask for the card again"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div data-sec="post" style={{ display: "flex", flexWrap: "wrap", maxWidth: "1320px", margin: "0 auto", padding: "22px 24px 40px", gap: "24px" }} data-testid="v2-writer">
      <main style={{ flex: "999 1 600px", minWidth: "0" }}>
        <div className="sec-band">
          <span className="sec-tile">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
            </svg>
          </span>
          <h1>Posts</h1>
          {thisWeek.length ? (
            <span className="sec-chip">
              <span className="live"></span>
              {thisWeek.length} this week
            </span>
          ) : null}
          <span className="pl-row" aria-label="For X, LinkedIn and Threads">
            <PlatformBadge platform="x" size={20} />
            <PlatformBadge platform="linkedin" size={20} />
            <PlatformBadge platform="threads" size={20} />
          </span>
          <span style={{ marginLeft: "auto" }}>
            <PostViewSwitch current="list" />
          </span>
        </div>

        <AllowanceBanner state={usageState} />
        <FreeLockedCard state={usageState} where="post" />

        <form
          className="ask"
          style={{ marginTop: "18px" }}
          onSubmit={(e) => {
            e.preventDefault();
            write();
          }}
        >
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--subtle)" }}>
            <path d="M12 20h9" />
            <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
          </svg>
          <label htmlFor="ask-writer" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Ask for a post
          </label>
          <input id="ask-writer" type="text" placeholder="Ask for a post" value={ask} onChange={(e) => setAsk(e.target.value)} />
          {/* Which platform, as the platforms' own icons: a toggle each instead of a select (owner, 2026-11-23). */}
          <span role="group" aria-label="Write for" style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap" }}>
            {ASK_KINDS.map((k) => (
              <button key={k.id} type="button" className="pick-btn" aria-pressed={askKind === k.id} onClick={() => setAskKind(k.id)} data-testid={`ask-kind-${k.id}`}>
                <PlatformBadge platform={k.id === "post" ? "x" : k.id} size={24} />
                {k.label.replace(/ post$/, "")}
              </button>
            ))}
          </span>
          <button type="submit" className="primary">
            Write it
          </button>
        </form>
        <p className="meta" style={{ margin: "8px 0 0" }}>
          Or{" "}
          <Link href="/app/compose" data-testid="writer-write-yourself">
            write it yourself
          </Link>
          : Ferreto checks each line against the platform&apos;s rules and for lines that read as AI. Reddit posts are written there.
        </p>

        <div className="tabs" role="tablist" aria-label="Writer">
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

        {state.status === "loading" ? <div className="meta" style={{ marginTop: "14px" }}>Loading…</div> : null}
        {state.status === "error" ? <div className="meta" style={{ marginTop: "14px" }}>{state.message}</div> : null}

        {tab !== "voice" && data ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0 10px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: "600" }}>{waiting.length - held - lost} waiting for your OK</span>
              {held ? <span className="meta">· {held} held until tomorrow</span> : null}
              {lost ? <span className="meta">· {lost} without a card</span> : null}
              <span className="meta">· {approved} approved this week</span>
              <div style={{ flex: "1 1 auto" }}></div>
              {platforms.length > 1 ? (
                <div role="group" aria-label="Platform" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {[null, ...platforms].map((p) => (
                    <button key={p ?? "all"} type="button" className="chip" aria-pressed={active === p} onClick={() => setPlatform(p)} style={{ cursor: "pointer" }}>
                      {p ? PLATFORM_LABEL[p] : "All"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {linkGone ? (
              <p className="meta" role="status" data-testid="writer-link-gone">
                That post is older than two weeks, so it is not listed here.
              </p>
            ) : null}
            {drafts.length === 0 ? <div className="meta">Nothing here yet. The week&apos;s posts are planned every Sunday from what people asked in Sales.</div> : null}
            {drafts.length
              ? POST_SECTIONS.map(({ id, label, empty }) => (
                  <section key={id} className="idx-section" aria-label={label} data-testid={`writer-section-${id}`}>
                    <h2 className="idx-head">
                      <span>{label}</span>
                      <span className="meta">{sections[id].length}</span>
                    </h2>
                    {sections[id].length ? <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{sections[id].map(renderRow)}</div> : <div className="meta">{active ? `No ${PLATFORM_LABEL[active as Draft["platform"]]} posts here.` : empty}</div>}
                  </section>
                ))
              : null}
          </>
        ) : null}

        {tab === "voice" && data ? (
          <section className="card" style={{ marginTop: "14px" }}>
            {data.voice.lines.length === 0 ? <div className="meta">Ferreto learns how you write from what you change in its drafts.</div> : null}
            {data.voice.lines.map((line) => (
              <div key={line.text} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ fontWeight: "500" }}>{line.text}</div>
                <div className="meta">{line.source}</div>
              </div>
            ))}
            <div style={{ marginTop: "10px" }}>
              <Link href="/app?doc=voice" className="ghost" style={{ textDecoration: "none" }}>
                Edit your voice
              </Link>
            </div>
          </section>
        ) : null}
      </main>

      <aside style={{ flex: "1 1 300px", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
            <h2 style={{ margin: "0", fontSize: "14px", fontWeight: "600" }}>This week</h2>
            <Link href="/app/schedule" style={{ fontSize: "12.5px", textDecoration: "none" }}>
              Week view
            </Link>
          </div>
          {week.length === 0 ? <div className="meta">The week's plan lands here on Sunday.</div> : null}
          {week.map((d) => (
            <div key={d.id} className="day">
              <span className="d">{(d.at ? new Date(d.at).toLocaleDateString("en-GB", { weekday: "short" }) : (d.dayText ?? "").slice(0, 3)).toUpperCase()}</span>
              <span className="dot" style={{ background: d.column === "posted" || d.column === "scheduled" ? "var(--ok)" : "var(--warn)" }}></span>
              <span style={{ flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kindOf(d)}</span>
              <span className="meta">{badgeOf(d)[0].toLowerCase()}</span>
            </div>
          ))}
        </section>
        <section className="card" aria-labelledby="writer-voice-title">
          <h2 id="writer-voice-title" style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: "600" }}>Your voice</h2>
          <p className="meta" style={{ margin: "0 0 10px", fontSize: "13px" }}>
            Ferreto learns how you write from what you change in its drafts.
          </p>
          {data?.voice.wordsCut.length ? (
            <>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Words you cut
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                {data.voice.wordsCut.map((w) => (
                  <span key={w} className="cut">
                    {w}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {data?.voice.lines.length ? (
            <>
              <div className="meta" style={{ marginBottom: "6px" }}>
                Rules it keeps
              </div>
              <ul style={{ margin: "0", paddingLeft: "18px", fontSize: "13.5px", lineHeight: "1.6" }}>
                {data.voice.lines.slice(0, 4).map((l) => (
                  <li key={l.text}>{l.text}</li>
                ))}
              </ul>
            </>
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
    <div className="detail" data-testid="writer-schedule-panel">
      <div className="meta">
        Goes out {formatWhen(draft.at!, timezone)} · {platform} · {timezone}
      </div>
      {draft.connected === false ? (
        <p className="meta" style={{ margin: "0" }} data-testid="writer-not-connected">
          No {platform} account is connected, so this does not go out on its own. Post it yourself at this time, or connect {platform} and it goes out by itself.
        </p>
      ) : null}
      {draft.slotId ? (
        <>
          <label className="meta" htmlFor={`writer-at-${draft.id}`}>
            New time ({timezone})
          </label>
          <input
            id={`writer-at-${draft.id}`}
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="writer-time-input"
            style={{ height: "32px", padding: "0 8px", border: "1px solid var(--line-2)", borderRadius: "7px", background: "var(--bg)", color: "var(--text)", font: "inherit", width: "fit-content" }}
          />
          <div className="meta">Ferreto asks you to approve the new time before it goes out.</div>
        </>
      ) : (
        <div className="meta">Its time is set in the calendar.</div>
      )}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {draft.slotId ? (
          <button type="button" className="primary" disabled={saving || !at || value === initial} onClick={() => at && onMove(at)} data-testid="writer-save-time">
            {saving ? "Saving…" : "Save the time"}
          </button>
        ) : null}
        <Link className="ghost" style={{ textDecoration: "none" }} href={`/app/schedule?from=${localMonday(Date.parse(draft.at!), timezone)}`} data-testid="writer-in-calendar">
          See it in the calendar
        </Link>
        <button type="button" className="skip" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
