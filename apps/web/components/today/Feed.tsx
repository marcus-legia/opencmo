"use client";

/**
 * The feed (Main.dc.html): the Context column on the left, then the greeting, the week's workflow, the list that needs
 * the founder (one row per thing, opened in place) and the agents. The chat column on the right is the shell's.
 *
 * Data: `DashboardScreen` (`/api/v1/screens/dashboard`) for the queue, Today, the goal and the team; Schedule's week for
 * what is planned, scheduled and posted. Rows open the real approval card, so every decision keeps its own actions.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { PlanSheet } from "@/components/billing/PlanSheet";
import { ApprovalCard, type DecideHandler } from "@/components/cards/ApprovalCard";
import { RatingSheet } from "@/components/cards/RatingSheet";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useDashboard } from "@/components/dashboard/useDashboard";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { isTodayPrompt } from "@/lib/cmo/today";
import type { ApprovalCard as Card } from "@/lib/screens/approval-card";
import type { DashboardScreen, TodayRowData } from "@/lib/screens/dashboard";

import { ContextColumn } from "./ContextColumn";
import { KIND_ICON, PLATFORM_ICON, kindLabel, whenLabel } from "./cards";

type Step = "planned" | "waiting" | "making" | "scheduled" | "posted";

const dayLine = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

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
}: {
  inv?: boolean;
  icon: ReactNode;
  kind: string;
  title: string;
  meta?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
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
    <div className={inv ? "item inv" : "item"}>
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
      inv={inv}
      icon={card.kind === "post" && card.account ? (PLATFORM_ICON[card.account.platform] ?? KIND_ICON.post) : KIND_ICON[card.kind]}
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
    href: "/app/brain",
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

export function Feed({ email }: { email?: string | null }) {
  const router = useRouter();
  const { state, decideCard, reload, planSheet, closePlanSheet } = useDashboard();
  const [week] = useScreen("schedule");
  const { focusChat, workVersion } = useShellState();
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

  const counts = useMemo(() => {
    const waiting = data?.queue.filter((c) => c.status === "waiting").length ?? 0;
    return {
      planned: data?.week.deliverables.total ?? 0,
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

  const done = data?.today.done ?? 0;
  const total = Math.max(data?.today.total ?? 0, done);
  const progress = total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
  const name = firstName(email);
  const needs = counts.waiting;

  const slotRows = (wanted: "scheduled" | "posted" | "all") =>
    slots
      .filter((s) => (wanted === "all" ? true : s.status === wanted))
      .map((s) => (
        <Row
          key={s.id}
          icon={PLATFORM_ICON[s.where.platform] ?? KIND_ICON.post}
          kind={`${s.where.platform === "x" ? "X" : s.where.platform.charAt(0).toUpperCase() + s.where.platform.slice(1)} post`}
          title={s.title}
          meta={s.note ?? dayLine.format(new Date(s.at))}
        />
      ));

  return (
    <>
      <PlanSheet open={planSheet} onClose={closePlanSheet} />
      <RatingSheet open={rating} onClose={closeRating} />
      <ContextColumn goal={data ? { text: data.week.goal, done: data.week.deliverables.done, total: data.week.deliverables.total } : null} />

      <main className="mid" data-testid="v2-dashboard">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid var(--line)" }}>
          <div className="seg" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected="true">
              Feed
            </button>
            <button type="button" role="tab" aria-selected="false" onClick={() => router.push("/app/schedule")}>
              Calendar
            </button>
            <button type="button" role="tab" aria-selected="false" onClick={() => router.push("/app/analytics")}>
              Analytics
            </button>
          </div>
          <span className="meta">{dayLine.format(new Date()).replace(",", "")}</span>
        </div>

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
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "13px", lineHeight: "18px" }}>
                {state.status === "loading"
                  ? "Loading your team…"
                  : needs === 0
                    ? "Nothing waits on you. Your team keeps working."
                    : `${needs} ${needs === 1 ? "item needs" : "items need"} your attention today. Approve, edit or skip.`}
              </p>
            </div>
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
                <button type="button" aria-pressed={step === s.id} onClick={() => setStep(s.id)}>
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

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "26px" }} data-testid="approval-queue">
            {step === "waiting" && data && live ? (
              ordered.length === 0 ? (
                <div className="item">
                  <div className="row" style={{ justifyContent: "center", color: "var(--muted)" }}>
                    {ICON_SPARK}
                    Nothing waits on you. Tomorrow&apos;s post is written overnight.
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
            {step === "scheduled" ? slotRows("scheduled") : null}
            {step === "posted" ? slotRows("posted") : null}
            {step === "planned" ? slotRows("all") : null}
            {step === "making" && data
              ? data.team.nodes
                  .filter((n) => n.state === "working")
                  .map((n) => (
                    <Row
                      key={n.department}
                      icon={KIND_ICON.slideshow}
                      kind={n.department.charAt(0).toUpperCase() + n.department.slice(1)}
                      title={n.line}
                      meta={<span className="live"></span>}
                    />
                  ))
              : null}
          </div>

          <div className="sec">
            <h2>Agents</h2>
            <span className="meta">{data ? `${data.team.nodes.filter((n) => n.state === "working").length} working for you` : ""}</span>
          </div>
          <section className="agents" aria-label="Your team">
            {AGENT_ROWS.map((a) => {
              const status = data ? agentLine(data, a.key) : { line: "", live: false };
              return (
                <Link key={a.key} href={a.href} className="agent" style={{ textDecoration: "none", color: "inherit" }} aria-label={`${a.label}: ${status.line}`}>
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
