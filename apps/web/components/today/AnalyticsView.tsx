"use client";

import { useState } from "react";

import { fillChat } from "@/components/dashboard/TodayBlock";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { BEST_HOURS, type Range } from "@/lib/screens/analytics";
import { PLATFORM_LABEL } from "@/lib/screens/common";

const RANGES: { id: Range; label: string; title: string; compare: string }[] = [
  { id: 7, label: "Week", title: "This week", compare: "compared with last week" },
  { id: 30, label: "Month", title: "This month", compare: "compared with the month before" },
  { id: 90, label: "90 days", title: "Last 90 days", compare: "compared with the 90 days before" },
];

const n = new Intl.NumberFormat("en-US");
const dayName = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));
const postDay = (iso: string | undefined) => (iso ? new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(iso)) : null);

/**
 * Analytics (Analytics.dc.html): the week against the last, views per day, the best times to post, what worked and the
 * competitors' outliers. Numbers come from the connected accounts (`/screens/analytics`), the goal from the feed, the
 * replies from Sales and the outliers from Research; a block without data says so instead of drawing zeros.
 */
export function AnalyticsView() {
  const [range, setRange] = useState<Range>(7);
  const [state] = useScreen("analytics", { range: String(range) });
  const [dash] = useScreen("dashboard");
  const [sales] = useScreen("sales");
  const [research] = useScreen("research");
  const { focusChat } = useShellState();
  const data = state.status === "ready" ? state.data : null;
  const meta = RANGES.find((r) => r.id === range)!;

  const kpi = (key: string) => data?.kpis.find((k) => k.key === key) ?? null;
  const days = data?.daily ?? [];
  // Views per day: what X reported, the artboard's chart; another platform when X has nothing.
  const platform = days.some((d) => typeof d.values.x === "number") ? "x" : (Object.keys(days.find((d) => Object.keys(d.values).length)?.values ?? {})[0] as keyof typeof PLATFORM_LABEL | undefined);
  const series = days.map((d) => ({ day: d.day, value: platform ? (d.values[platform] ?? null) : null }));
  const shown = series.slice(-7);
  const max = Math.max(1, ...shown.map((s) => s.value ?? 0));
  const top = shown.reduce<(typeof shown)[number] | null>((best, s) => ((s.value ?? -1) > (best?.value ?? -1) ? s : best), null);
  const views = shown.reduce((sum, s) => sum + (s.value ?? 0), 0);
  const impressions = kpi("impressions");
  const goal = dash.status === "ready" ? (dash.data as { week: { goal: string | null; deliverables: { done: number; total: number } } }).week : null;
  const replied = sales.status === "ready" ? (sales.data as { week: { replied: number; dismissed: number } }).week : null;
  const posts = data?.posts ?? [];
  const outliers =
    research.status === "ready"
      ? (research.data as { insights: { id: string; type: string; scope: string; platform: string; text: string; evidence: string; sources: string[]; video?: { outlier: number | null } }[] }).insights.filter((i) => i.scope === "competitors").slice(0, 3)
      : [];
  const published = kpi("posts_measured");

  return (
    <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "22px 24px 40px" }} data-testid="v2-analytics">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
        <h1 style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>{meta.title}</h1>
        <span className="meta">
          {days.length ? `${dayShort(days[Math.max(0, days.length - range)]!.day)} – ${dayShort(days[days.length - 1]!.day)} · ` : ""}
          {meta.compare}
        </span>
        <div style={{ flex: "1 1 auto" }}></div>
        <div className="seg" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "12px", marginBottom: "12px" }} className="td-kpis" role="region" aria-label="Totals">
        <div className="card">
          <div className="meta">{goal?.goal ? `Goal: ${goal.goal}` : "Goal this week"}</div>
          <div className="kpi">
            {goal?.deliverables.done ?? "–"} <span style={{ fontSize: "15px", color: "var(--subtle)", fontWeight: "500" }}>/ {goal?.deliverables.total ?? "–"}</span>
          </div>
          <div style={{ height: "4px", borderRadius: "4px", background: "var(--line-2)", marginTop: "10px" }}>
            <div style={{ width: `${goal && goal.deliverables.total ? Math.round((goal.deliverables.done / goal.deliverables.total) * 100) : 0}%`, height: "4px", borderRadius: "4px", background: "var(--accent)" }}></div>
          </div>
        </div>
        <div className="card">
          <div className="meta">Views{platform ? ` on ${PLATFORM_LABEL[platform]}` : ""}</div>
          <div className="kpi">{platform && shown.some((d) => d.value !== null) ? n.format(views) : "–"}</div>
          {impressions?.change != null ? (
            <div className={impressions.change >= 0 ? "up" : "meta"}>
              {impressions.change >= 0 ? "+" : ""}
              {Math.round(impressions.change)}% vs last {range === 7 ? "week" : "period"}
            </div>
          ) : (
            <div className="meta">Nothing to compare yet</div>
          )}
        </div>
        <div className="card">
          <div className="meta">Posts published</div>
          <div className="kpi">{published?.value ?? "–"}</div>
          <div className="meta">{published?.note ?? " "}</div>
        </div>
        <div className="card">
          <div className="meta">Reddit replies</div>
          <div className="kpi">{replied?.replied ?? "–"}</div>
          <div className="meta">{replied ? `${replied.dismissed} dismissed this week` : " "}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: "12px", marginBottom: "12px" }} className="td-two">
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2>Views per day</h2>
            <span className="meta">{platform ? `${PLATFORM_LABEL[platform]} · all posts` : "no account reports yet"}</span>
          </div>
          <div className="bars" role="img" aria-label={`Views per day: ${shown.map((s) => `${dayName(s.day)} ${s.value ?? "no data"}`).join(", ")}`}>
            {shown.map((s) => (
              <div key={s.day} className={s === top && s.value ? "bar on" : "bar"} style={{ height: `${s.value === null ? 2 : Math.max(2, Math.round((s.value / max) * 100))}%`, opacity: s.value === null ? 0.35 : undefined }}>
                <span>{s.value === null ? "–" : n.format(s.value)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, shown.length)},minmax(0,1fr))`, gap: "10px", marginTop: "6px" }} className="meta">
            {shown.map((s) => (
              <span key={s.day} style={{ textAlign: "center" }}>
                {dayName(s.day)}
              </span>
            ))}
          </div>
          {top?.value && posts[0] ? (
            <p className="meta" style={{ margin: "10px 0 0" }}>
              {dayName(top.day)}: best day of the {range === 7 ? "week" : "range"}. Top post: “{posts[0].title.replace(/^[“"]|[”"]$/g, "")}”
              {posts[0].impressions != null ? `, ${n.format(posts[0].impressions)} views` : ""}.
            </p>
          ) : null}
        </section>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2>Best times to post</h2>
            <span className="meta">from your posts in this range</span>
          </div>
          {data?.bestTimes ? (
            <>
              <div className="heat" aria-label="Best posting times by day and hour">
                <span></span>
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <span key={i} style={{ textAlign: "center" }}>
                    {d}
                  </span>
                ))}
                {BEST_HOURS.map((h, row) => (
                  <span key={h} style={{ display: "contents" }}>
                    <span>{String(h).padStart(2, "0")}:00</span>
                    {data.bestTimes![row]!.map((level, col) => (
                      <div key={col} className={`c c${level}`}></div>
                    ))}
                  </span>
                ))}
              </div>
              <p className="meta" style={{ margin: "12px 0 0" }}>Darker means more views per post than your median.</p>
            </>
          ) : (
            <p className="meta" style={{ margin: "12px 0 0" }}>Shows once a few of your posts have reported their views.</p>
          )}
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "12px" }} className="td-two">
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
            <h2>What worked</h2>
            <span className="meta">your posts, by views</span>
          </div>
          {posts.length === 0 ? <p className="meta">Your best and worst posts show here once they report.</p> : null}
          {posts.slice(0, 3).map((p) => (
            <div key={p.id} className="row">
              <span className="mult" style={p.vsMedian !== null && p.vsMedian < 1 ? { color: "var(--muted)" } : undefined}>
                {p.vsMedian !== null ? `${p.vsMedian}×` : "–"}
              </span>
              <span style={{ flex: "1", minWidth: "0" }}>
                <span style={{ display: "block", fontWeight: "500" }}>{p.title.replace(/^[“"]|[”"]$/g, "")}</span>
                <span className="meta">{[PLATFORM_LABEL[p.platform], postDay(p.publishedAt), p.impressions != null ? `${n.format(p.impressions)} views` : null].filter(Boolean).join(" · ")}</span>
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  focusChat();
                  fillChat(p.vsMedian !== null && p.vsMedian < 1 ? `Why did "${p.title}" do worse than usual?` : `Plan more posts like "${p.title}".`);
                }}
              >
                {p.vsMedian !== null && p.vsMedian < 1 ? "Ask why" : "Plan more like this"}
              </button>
            </div>
          ))}
        </section>
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
            <h2>Competitors&apos; outliers</h2>
            <span className="meta">Research</span>
          </div>
          {outliers.length === 0 ? <p className="meta">Research adds what works for your competitors after its next run.</p> : null}
          {outliers.map((o) => (
            <div key={o.id} className="row">
              <span className="mult">{o.video?.outlier ? `${o.video.outlier}×` : o.type}</span>
              <span style={{ flex: "1", minWidth: "0" }}>
                <a href={o.sources[0]} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontWeight: "500", color: "var(--text)", textDecoration: "none" }}>
                  {o.text}
                </a>
                <span className="meta">{o.evidence}</span>
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  focusChat();
                  fillChat(`Write a post using this ${o.type}: ${o.text}`);
                }}
              >
                Use this {o.type === "idea" ? "idea" : o.type}
              </button>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
