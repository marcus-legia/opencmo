"use client";

/**
 * The feed (Main.dc.html): the greeting, the week's workflow, the list that needs the founder (one row per thing,
 * opened in place) and the agents. The Context column on the left and the chat on the right are the shell's, so they
 * stay put when the founder switches to Calendar, Sales or Analytics.
 *
 * Data: `DashboardScreen` (`/api/v1/screens/dashboard`) for the queue, Today, the goal and the team; Schedule's week for
 * what is planned, scheduled and posted. Rows open the real approval card, so every decision keeps its own actions.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { PlanSheet } from "@/components/billing/PlanSheet";
import { ApprovalCard, type DecideHandler } from "@/components/cards/ApprovalCard";
import { RatingSheet } from "@/components/cards/RatingSheet";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useDashboard } from "@/components/dashboard/useDashboard";
import { useLive } from "@/components/clipping/useLive";
import { useShellAccount } from "@/components/clipping/web/WebShell";
import { useShellState } from "@/components/shell-v2/ShellState";
import { prefetchScreen, useScreen } from "@/components/screens/useScreen";
import { isTodayPrompt } from "@/lib/cmo/today";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import type { WriterScreen } from "@/lib/screens/writer";
import type { DashboardScreen, TodayRowData } from "@/lib/screens/dashboard";
import type { ScreenName } from "@/lib/screens/registry";

import { KIND_ICON, PLATFORM_ICON, cardIcon, kindLabel, whenLabel } from "./cards";
import { dayLabel, draftsLeftOver, draftsThisWeek } from "./week";

type Draft = WriterScreen["drafts"][number];

type Step = "planned" | "waiting" | "making" | "scheduled" | "posted";

const dayLine = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const timeLine = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** Where a piece of the week stands, in the founder's words. The feed keeps a row for it at every step. */
const STAGE: Record<Draft["column"], { label: string; tone: "plan" | "new" | "wait" | "ok" }> = {
  planned: { label: "Planned", tone: "plan" },
  drafting: { label: "Being written", tone: "new" },
  waiting: { label: "Waiting on you", tone: "wait" },
  scheduled: { label: "Approved", tone: "ok" },
  posted: { label: "Posted", tone: "ok" },
};

const draftKind = (d: Draft) =>
  d.kind === "video_brief" ? "Script · you record" : d.kind === "slide_text" ? "Slideshow" : d.kind === "caption" ? `${PLATFORM_LABEL[d.platform] ?? d.platform} video` : `${PLATFORM_LABEL[d.platform] ?? d.platform} post`;
const draftIcon = (d: Draft) =>
  d.kind === "video_brief" ? KIND_ICON.script : d.kind === "slide_text" ? KIND_ICON.slideshow : d.kind === "caption" ? KIND_ICON.price : (PLATFORM_ICON[d.platform] ?? KIND_ICON.post);

/** "Thu 12 Nov, 09:00" for a draft with a time, its day otherwise. */
function draftWhen(d: Draft): string | null {
  if (d.at) return timeLine.format(new Date(d.at));
  return dayLabel(d);
}

const WHO: Record<string, string> = { you: "You", brain: "Planner", writer: "Writer", studio: "Studio", schedule: "Publisher", publish: "Publisher", sales: "Sales", research: "Research" };

/** "just now", "12 min ago", "3 h ago", then the day. */
function ago(at: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return dayLine.format(new Date(at));
}

/** "marcus.le@…" → "Marcus": the greeting uses the founder's first name when the email gives one. */
function firstName(email: string | null | undefined): string | null {
  const local = (email ?? "").split("@")[0]?.split(/[._+\-\d]/)[0] ?? "";
  return local.length >= 2 ? local.charAt(0).toUpperCase() + local.slice(1).toLowerCase() : null;
}

/** The artboard's robot at the planning board, as drawn there. */
function Robot() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label="Your CMO at the planning board" style={{ flexShrink: "0" }}>
      <rect className="rb-bg" x="0.75" y="0.75" width="54.5" height="54.5" rx="12" strokeWidth="1.5" />
      <rect className="rb-m" x="31" y="11" width="17" height="14" rx="2" fill="none" strokeWidth="1.5" />
      <line className="r-l1 rb-a" x1="34" y1="15" x2="44" y2="15" strokeWidth="1.5" strokeLinecap="round" />
      <line className="r-l2 rb-a" x1="34" y1="18" x2="41" y2="18" strokeWidth="1.5" strokeLinecap="round" />
      <line className="r-l3 rb-a" x1="34" y1="21" x2="43" y2="21" strokeWidth="1.5" strokeLinecap="round" />
      <line className="rb-m" x1="17" y1="12" x2="17" y2="16" strokeWidth="1.5" strokeLinecap="round" />
      <circle className="rb-ok" cx="17" cy="10.5" r="1.8" />
      <rect className="rb-t" x="9" y="16" width="16" height="12" rx="4" fill="none" strokeWidth="1.5" />
      <circle className="r-eye rb-tf" cx="14" cy="22" r="1.4" />
      <circle className="r-eye rb-tf" cx="20" cy="22" r="1.4" />
      <rect className="rb-t" x="10" y="31" width="14" height="13" rx="3.5" fill="none" strokeWidth="1.5" />
      <g className="r-arm">
        <line className="rb-t" x1="24" y1="34" x2="31" y2="27" strokeWidth="1.5" strokeLinecap="round" />
        <circle className="rb-af" cx="31.5" cy="26.5" r="1.4" />
      </g>
      <line className="rb-t" x1="14" y1="44" x2="14" y2="48" strokeWidth="1.5" strokeLinecap="round" />
      <line className="rb-t" x1="20" y1="44" x2="20" y2="48" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const Chevron = ({ up, color }: { up?: boolean; color?: string }) => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={color ? { color } : undefined}>
    <path d={up ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
  </svg>
);

/** One row of the list, as the artboard draws it: tile, kind and title, a short meta, then its actions or a chevron. */
function Row({
  inv,
  icon,
  kind,
  title,
  meta,
  open,
  onToggle,
  actions,
  children,
  cardId,
  testId = "feed-row",
}: {
  testId?: string;
  inv?: boolean;
  icon: ReactNode;
  kind: string;
  title: string;
  meta?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  /** The approval card behind the row, for tests and the row's own lookups. */
  cardId?: string;
}) {
  const line = (
    <>
      <span className="tile">{icon}</span>
      <span className="ttl">
        <span className="kind">{kind} · </span>
        {title}
      </span>
      {meta ? <span className="meta">{meta}</span> : null}
    </>
  );
  return (
    <div className={inv ? "item inv" : "item"} data-testid={testId} data-card-id={cardId}>
      {onToggle && !actions ? (
        <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
          {line}
          <Chevron up={open} color={inv ? "var(--inv-muted)" : "var(--subtle)"} />
        </button>
      ) : (
        <div className="row">
          {line}
          {actions}
        </div>
      )}
      {open && children ? <div className="detail td-cardhost">{children}</div> : null}
    </div>
  );
}

function CardRow({ card, inv, open, onToggle, onLater, onDecide, sample }: { card: Card; inv: boolean; open: boolean; onToggle: () => void; onLater: () => void; onDecide: DecideHandler; sample: boolean }) {
  const label = kindLabel(card);
  const meta = whenLabel(card);
  return (
    <Row
      cardId={card.id}
      inv={inv}
      icon={cardIcon(card)}
      kind={label}
      title={card.title}
      meta={meta}
      open={open}
      onToggle={onToggle}
      actions={
        inv || open ? undefined : (
          <>
            <button type="button" className="skip" onClick={onLater}>
              Not now
            </button>
            <button type="button" className="do" onClick={onToggle}>
              Review
            </button>
          </>
        )
      }
    >
      {/* The real card body: its versions, text, time and every action it has (cards.css draws it as the artboard does). */}
      <ApprovalCard card={card} sample={sample} onDecide={onDecide} open headingLevel="h3" />
    </Row>
  );
}

function TodayAction({ row, onAsk }: { row: TodayRowData; onAsk: () => void }) {
  if (row.action.type === "chat") {
    const prompt = row.action.prompt;
    return (
      <button
        type="button"
        className="do"
        onClick={() => {
          onAsk();
          fillChat(prompt);
        }}
      >
        {row.action.label}
      </button>
    );
  }
  if (row.action.type === "link") {
    return (
      <Link className="do" href={row.action.href} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
        {row.action.label}
      </Link>
    );
  }
  return null;
}

const ICON_SPARK = (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);

const AGENT_ROWS: { key: "brain" | "writer" | "studio" | "schedule" | "sales" | "research"; label: string; href: string; icon: ReactNode }[] = [
  {
    key: "brain",
    label: "Planner",
    href: "/app?doc=plan",
    icon: (
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M3 10h18" />
      </svg>
    ),
  },
  {
    key: "writer",
    label: "Writer",
    href: "/app/writer",
    icon: (
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      </svg>
    ),
  },
  {
    key: "studio",
    label: "Studio",
    href: "/app/studio",
    icon: (
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="m10 8 4 2-4 2z" />
      </svg>
    ),
  },
  {
    key: "schedule",
    label: "Publisher",
    href: "/app/schedule",
    icon: (
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3 11 18-5v12L3 14v-3z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    ),
  },
  {
    key: "sales",
    label: "Sales",
    href: "/app/sales",
    icon: (
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    ),
  },
  {
    key: "research",
    label: "Research",
    href: "/app/research",
    icon: (
      <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
  },
];

/** What each agent's page reads first: its link reads it ahead on hover or focus. */
const AGENT_SCREEN: Record<(typeof AGENT_ROWS)[number]["key"], ScreenName> = {
  brain: "brain",
  writer: "writer",
  studio: "studio",
  schedule: "schedule",
  sales: "sales",
  research: "research",
};

function agentLine(data: DashboardScreen, key: (typeof AGENT_ROWS)[number]["key"]): { line: string; live: boolean } {
  if (key === "brain") {
    const next = data.team.brain.nextCheckAt;
    const when = next ? new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(next)) : null;
    if (data.team.brain.state === "paused") return { line: "Paused", live: false };
    return { line: when ? `Next check ${when}` : `Watching ${data.team.brain.watching} orders`, live: false };
  }
  const node = data.team.nodes.find((n) => n.department === key);
  if (!node) return { line: "", live: false };
  return { line: node.line, live: node.state === "working" };
}

/** Rows a section shows before "Show more": the feed stays one screen tall. */
const BOX_ROWS = 5;

/**
 * One section's rows in their own frame, five at a time (owner, 2026-11-12: the feed ran far down the page). `keep`
 * opens it whole, so a card opened from a row below the fifth is never hidden.
 */
function Box({ children, testId, keep = false }: { children: ReactNode; testId: string; keep?: boolean }) {
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  const open = all || keep;
  const more = rows.length - BOX_ROWS;
  return (
    <div className="td-box" data-testid={testId}>
      {open ? rows : rows.slice(0, BOX_ROWS)}
      {more > 0 && !keep ? (
        <button type="button" className="td-box-more" aria-expanded={all} onClick={() => setAll(!all)} data-testid={`${testId}-more`}>
          {all ? "Show less" : `Show ${more} more`}
        </button>
      ) : null}
    </div>
  );
}

export function Feed({ email }: { email?: string | null }) {
  const { state, decideCard, reload, planSheet, closePlanSheet } = useDashboard();
  const [week, reloadWeek] = useScreen("schedule");
  const [writer, reloadWriter] = useScreen("writer");
  const { focusChat, openLogs, workVersion } = useShellState();
  const { userId } = useShellAccount();
  const search = useSearchParams();
  const [step, setStep] = useState<Step>("waiting");
  const [open, setOpen] = useState<string | null>(null);
  const [later, setLater] = useState<ReadonlySet<string>>(new Set());

  // `?ask=1` and Today's `prompt` land in the chat's box; the founder sends it. Only a request Today writes is taken.
  const asking = search.get("ask") === "1";
  const asked = search.get("prompt") ?? "";
  const prompt = isTodayPrompt(asked) ? asked : "";
  useEffect(() => {
    if (!asking) return;
    focusChat();
    if (prompt) fillChat(prompt);
    const url = new URL(window.location.href);
    url.searchParams.delete("ask");
    url.searchParams.delete("prompt");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [asking, prompt, focusChat]);
  // `?rate=1`: "Rate your first drafts" (cmo-review-3 2.2) opens over the feed while the flag is there.
  const rating = search.get("rate") === "1";
  const closeRating = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("rate");
    window.history.replaceState(null, "", url.pathname + url.search);
    void reload();
  }, [reload]);
  useEffect(() => {
    if (workVersion > 0) void reload();
  }, [workVersion, reload]);

  const data = state.status === "ready" ? state.data : null;
  const live = state.status === "ready" ? state.live : null;
  const slots = week.status === "ready" ? week.data.slots : [];
  const drafts = useMemo(() => (writer.status === "ready" ? draftsThisWeek(writer.data.drafts) : []), [writer]);
  // Last week's drafts nobody decided: not this week's, but still the founder's to approve or skip.
  const leftOver = useMemo(() => (writer.status === "ready" ? draftsLeftOver(writer.data.drafts) : []), [writer]);

  // The week's rows and the calendar's slots are their own reads. Whatever moves the queue (a decision here, a new
  // card, a line in the log, Refresh) also moves them, so they are read again right after it: an approved post turns
  // "Approved" in place instead of vanishing until the next visit. One read for a burst of events.
  const side = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSide = useCallback(() => {
    if (side.current) clearTimeout(side.current);
    side.current = setTimeout(() => {
      reloadWeek();
      reloadWriter();
    }, 400);
  }, [reloadWeek, reloadWriter]);
  useEffect(() => () => void (side.current && clearTimeout(side.current)), []);
  const queueRef = data?.queue;
  const logRef = data?.log;
  const seen = useRef(false);
  useEffect(() => {
    if (!queueRef) return;
    // The first answer arrives with the side reads already under way.
    if (!seen.current) {
      seen.current = true;
      return;
    }
    reloadSide();
  }, [queueRef, logRef, reloadSide]);
  // A slot that changes on its own (published, missed, moved from the Calendar in another tab).
  useLive("schedule_slots", userId ? `user_id=eq.${userId}` : null, reloadSide, Boolean(userId) && Boolean(live?.queue), false, "feed");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const counts = useMemo(() => {
    const waiting = data?.queue.filter((c) => c.status === "waiting").length ?? 0;
    return {
      // A week without a plan still has its calendar: count what Writer lists for this week too.
      planned: Math.max(data?.week.deliverables.total ?? 0, data?.week.itemsThisWeek ?? 0),
      waiting,
      making: data?.team.nodes.filter((n) => n.state === "working").length ?? 0,
      scheduled: slots.filter((s) => s.status === "scheduled").length,
      posted: slots.filter((s) => s.status === "posted").length,
    };
  }, [data, slots]);

  const steps: { id: Step; label: string }[] = [
    { id: "planned", label: "planned" },
    { id: "waiting", label: "waiting on you" },
    { id: "making", label: "being made" },
    { id: "scheduled", label: "scheduled" },
    { id: "posted", label: "posted" },
  ];

  const cards = (data?.queue ?? []).filter((c) => c.status === "waiting" && !later.has(c.id));
  const todayRows = data?.today.rows ?? [];
  const inToday = new Set(todayRows.flatMap((r) => (r.action.type === "card" ? [r.action.approvalId] : [])));
  // Today's rows first (in their order), then every other card that waits: one list, as on the artboard.
  type Item = { type: "card"; card: Card } | { type: "row"; row: TodayRowData };
  const ordered: Item[] = [];
  for (const row of todayRows) {
    if (row.action.type !== "card") {
      ordered.push({ type: "row", row });
      continue;
    }
    const id = row.action.approvalId;
    const card = cards.find((c) => c.id === id);
    if (card) ordered.push({ type: "card", card });
  }
  for (const card of cards) if (!inToday.has(card.id)) ordered.push({ type: "card", card });
  const firstCard = ordered.find((item): item is { type: "card"; card: Card } => item.type === "card");
  const firstCardId = firstCard ? firstCard.card.id : null;
  const openId = open ?? firstCardId;
  // A card opened below the fifth row (from This week's Review) opens the Today frame whole, so it is on screen.
  const openBeyond = openId !== null && ordered.findIndex((item) => item.type === "card" && item.card.id === openId) >= BOX_ROWS;

  /** Opens a waiting card where it sits in the list above and brings it into view. */
  const review = (approvalId: string) => {
    setStep("waiting");
    setLater((was) => new Set([...was].filter((id) => id !== approvalId)));
    setOpen(approvalId);
    requestAnimationFrame(() => document.querySelector(`[data-testid="feed-row"][data-card-id="${CSS.escape(approvalId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const queued = new Set((data?.queue ?? []).filter((c) => c.status === "waiting").map((c) => c.id));

  const weekRow = (d: Draft) => {
    const stage = STAGE[d.column];
    const when = draftWhen(d);
    return (
      <Row
        key={d.id}
        testId="week-row"
        icon={draftIcon(d)}
        kind={draftKind(d)}
        title={d.title}
        meta={d.column === "scheduled" && when ? `Goes out ${when}` : d.column === "posted" && when ? when : (when ?? undefined)}
        actions={
          <>
            <span className={`stage ${stage.tone}`} data-stage={d.column}>
              {stage.label}
            </span>
            {d.column === "waiting" ? (
              d.approvalId && queued.has(d.approvalId) ? (
                <button type="button" className="do" onClick={() => review(d.approvalId!)}>
                  Review
                </button>
              ) : (
                <Link className="do td-rowlink" href="/app/writer">
                  Open in Writer
                </Link>
              )
            ) : d.column === "scheduled" || d.column === "posted" ? (
              <Link className="skip td-rowlink" href="/app/schedule">
                Calendar
              </Link>
            ) : null}
          </>
        }
      />
    );
  };
  const emptyRow = (text: ReactNode) => (
    <div className="item">
      <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
        {text}
      </div>
    </div>
  );

  const done = data?.today.done ?? 0;
  const total = Math.max(data?.today.total ?? 0, done);
  const progress = total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
  const name = firstName(email);
  const needs = counts.waiting;
  const held = data?.week.heldCards ?? 0;

  const slotRows = (wanted: "scheduled" | "posted") =>
    slots
      .filter((s) => s.status === wanted)
      .map((s) => (
        <Row
          key={s.id}
          icon={PLATFORM_ICON[s.where.platform] ?? KIND_ICON.post}
          kind={`${s.where.platform === "x" ? "X" : s.where.platform.charAt(0).toUpperCase() + s.where.platform.slice(1)} post`}
          title={s.title}
          meta={s.note ?? timeLine.format(new Date(s.at))}
          actions={
            <>
              <span className="stage ok">{wanted === "posted" ? "Posted" : "Approved"}</span>
              <Link className="skip td-rowlink" href="/app/schedule">
                Calendar
              </Link>
            </>
          }
        />
      ));
  const scheduledRows = slotRows("scheduled");
  const postedRows = slotRows("posted");
  const working = data?.team.nodes.filter((n) => n.state === "working") ?? [];

  return (
    <>
      <PlanSheet open={planSheet} onClose={closePlanSheet} />
      <RatingSheet open={rating} onClose={closeRating} />

      <main className="mid" data-testid="v2-dashboard">
        <div style={{ flex: "1 1 auto", overflow: "auto", padding: "18px 24px 40px", maxWidth: "920px", width: "100%", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "16px" }}>
            <Robot />
            <div style={{ flex: "1 1 auto", minWidth: "0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h1 data-testid="dash-headline" style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px", lineHeight: "28px" }}>
                  {name ? `Welcome back, ${name}.` : "Welcome back."}
                </h1>
                <span className="live" title="Your CMO is working"></span>
              </div>
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "14px", lineHeight: "18px" }}>
                {state.status === "loading"
                  ? "Loading your team…"
                  : needs === 0
                    ? held > 0
                      ? `Nothing in the queue today. ${held} ${held === 1 ? "card is" : "cards are"} held until tomorrow.`
                      : "Nothing waits on you. Your team keeps working."
                    : `${needs} ${needs === 1 ? "item needs" : "items need"} your attention today. Approve, edit or skip.`}
              </p>
            </div>
            {/* The planner lives on the calendar: a founder who lands here first needs a way to it (which platforms, how often). */}
            <Link href="/app/schedule#posting-plan" className="ib" aria-label="Posting plan: pick your platforms and how often" title="Posting plan: pick your platforms and how often" data-testid="feed-posting-plan">
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 21v-7" />
                <path d="M4 10V3" />
                <path d="M12 21v-9" />
                <path d="M12 8V3" />
                <path d="M20 21v-5" />
                <path d="M20 12V3" />
                <path d="M2 14h4" />
                <path d="M10 8h4" />
                <path d="M18 16h4" />
              </svg>
            </Link>
            <button type="button" className="ib" aria-label="Refresh" onClick={() => void reload()}>
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </div>

          {state.status === "error" ? (
            <div className="item" role="alert">
              <div className="row" style={{ color: "var(--muted)" }}>
                {state.message}
                <div style={{ flex: "1 1 auto" }}></div>
                <button type="button" className="do" onClick={() => void reload()}>
                  Try again
                </button>
              </div>
            </div>
          ) : null}

          <div className="flow" role="group" aria-label="This week's workflow" style={{ marginBottom: "22px" }}>
            {steps.map((s, i) => (
              <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <button type="button" aria-pressed={step === s.id} onClick={() => setStep(s.id)} data-testid={`flow-${s.id}`}>
                  <b>{counts[s.id]}</b>
                  {s.label}
                </button>
                {i < steps.length - 1 ? (
                  <svg className="i s ar" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                ) : null}
              </span>
            ))}
          </div>

          <div className="sec">
            <h2>{step === "waiting" ? "Today" : steps.find((s) => s.id === step)!.label.replace(/^./, (c) => c.toUpperCase())}</h2>
            {step === "waiting" ? (
              <span className="meta" data-testid="today-count">
                <span className="prog" aria-hidden="true">
                  <i style={{ width: progress }}></i>
                </span>
                {done} of {total} done
              </span>
            ) : null}
          </div>

          <Box testId="approval-queue" keep={openBeyond}>
            {step === "waiting" && data && live ? (
              ordered.length === 0 ? (
                <div className="item">
                  <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
                    {ICON_SPARK}
                    {held > 0 ? (
                      <span>
                        {held} {held === 1 ? "card is" : "cards are"} held until tomorrow (about ten new cards a day).{" "}
                        <Link href="/app/writer" data-testid="today-held">
                          Show them in Writer
                        </Link>
                      </span>
                    ) : (
                      <>Nothing waits on you. Tomorrow&apos;s post is written overnight.</>
                    )}
                  </div>
                </div>
              ) : (
                ordered.map((item) =>
                  item.type === "card" ? (
                    <CardRow
                      key={item.card.id}
                      card={item.card}
                      inv={item.card.id === firstCardId}
                      open={openId === item.card.id}
                      onToggle={() => setOpen(openId === item.card.id ? "" : item.card.id)}
                      onLater={() => setLater((was) => new Set([...was, item.card.id]))}
                      onDecide={decideCard}
                      sample={!live.queue}
                    />
                  ) : (
                    <Row key={item.row.id} icon={ICON_SPARK} kind={item.row.department === "brain" ? "Your CMO" : item.row.department.charAt(0).toUpperCase() + item.row.department.slice(1)} title={item.row.title} meta={item.row.detail ?? undefined} actions={<TodayAction row={item.row} onAsk={focusChat} />} />
                  ),
                )
              )
            ) : null}
            {step === "scheduled" ? (scheduledRows.length ? scheduledRows : emptyRow("Nothing is scheduled yet. Approve a post and it shows here with its time.")) : null}
            {step === "posted" ? (postedRows.length ? postedRows : emptyRow("Nothing went out this week yet.")) : null}
            {step === "planned" ? (drafts.length ? drafts.map(weekRow) : emptyRow(writer.status === "loading" ? "Loading this week…" : "Nothing is planned for this week yet. Ask your CMO to plan the week.")) : null}
            {step === "making" && data
              ? working.length
                ? working.map((n) => (
                    <Row
                      key={n.department}
                      icon={KIND_ICON.slideshow}
                      kind={n.department.charAt(0).toUpperCase() + n.department.slice(1)}
                      title={n.line}
                      meta={<span className="live"></span>}
                    />
                  ))
                : emptyRow("Nobody is making anything right now.")
              : null}
          </Box>

          {/* The week, every piece with where it stands: what the founder approved stays on the feed. */}
          {step === "waiting" && (drafts.length > 0 || writer.status === "error") ? (
            <>
              <div className="sec">
                <h2>This week</h2>
                <span className="meta">
                  {drafts.filter((d) => d.column === "scheduled" || d.column === "posted").length} of {drafts.length} approved ·{" "}
                  <Link href="/app/schedule">Calendar</Link>
                </span>
              </div>
              <Box testId="feed-week">{writer.status === "error" ? emptyRow("This week could not be read. Refresh to try again.") : drafts.map(weekRow)}</Box>
            </>
          ) : null}

          {step === "waiting" && leftOver.length > 0 ? (
            <>
              <div className="sec">
                <h2>From last week</h2>
                <span className="meta">{leftOver.length} not approved yet · approve or skip them</span>
              </div>
              <Box testId="feed-left-over">{leftOver.map(weekRow)}</Box>
            </>
          ) : null}

          {step === "waiting" && data && data.log.length > 0 ? (
            <>
              <div className="sec">
                <h2>Activity</h2>
                <button type="button" className="skip" onClick={openLogs}>
                  All activity
                </button>
              </div>
              <ul className="td-activity" data-testid="feed-activity">
                {data.log.slice(0, 6).map((line) => (
                  <li key={line.id}>
                    {/* A decision is logged under the department it was for; the line itself starts with "You". */}
                    <span className={line.who === "you" || line.text.startsWith("You ") ? "who you" : "who"}>{line.text.startsWith("You ") ? "You" : (WHO[line.who] ?? line.who)}</span>
                    <span className="what">{line.text}</span>
                    <time dateTime={line.at}>{ago(line.at, now)}</time>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="sec">
            <h2>Agents</h2>
            <span className="meta">{data ? `${data.team.nodes.filter((n) => n.state === "working").length} working for you` : ""}</span>
          </div>
          <section className="agents" aria-label="Your team">
            {AGENT_ROWS.map((a) => {
              const status = data ? agentLine(data, a.key) : { line: "", live: false };
              return (
                <Link
                  key={a.key}
                  href={a.href}
                  className="agent"
                  style={{ textDecoration: "none", color: "inherit" }}
                  aria-label={`${a.label}: ${status.line}`}
                  onMouseEnter={() => prefetchScreen(AGENT_SCREEN[a.key])}
                  onFocus={() => prefetchScreen(AGENT_SCREEN[a.key])}
                >
                  <span className="tile">{a.icon}</span>
                  <span style={{ minWidth: "0", flex: "1" }}>
                    <span style={{ display: "block", fontWeight: "500" }}>{a.label}</span>
                    <span className="meta" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {status.line}
                    </span>
                  </span>
                  {status.live ? <span className="live"></span> : null}
                </Link>
              );
            })}
          </section>
        </div>
      </main>
    </>
  );
}
