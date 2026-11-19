"use client";

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { rate, type FunnelRow } from "@/lib/cmo/funnel-view";
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
const SOURCE_LABEL: Record<FunnelRow["source"], string> = { all: "All sources", reddit: "Reddit", hn: "Hacker News", facebook: "Facebook groups", threads: "Threads" };

/**
 * From a thread to a customer (wave 3, canvas board Analytics): found → replied → answered back → signed up over the
 * range, then the same per source. Rates are shown only where there is something to divide by.
 */
function FunnelSection({ days }: { days: number }) {
  const [rows, setRows] = useState<FunnelRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    api<{ rows: FunnelRow[] }>(`/sales/funnel?days=${days}`)
      .then((r) => alive && setRows(r.rows))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [days]);
  const all = rows?.find((r) => r.source === "all") ?? null;
  const steps = all
    ? [
        { label: "People found", n: all.found, of: null as string | null },
        { label: "You replied", n: all.replied, of: rate(all.replied, all.found) && `${rate(all.replied, all.found)} of found` },
        { label: "Answered back", n: all.answeredBack, of: rate(all.answeredBack, all.replied) && `${rate(all.answeredBack, all.replied)} of replies` },
        { label: "Signed up", n: all.signedUp, of: all.signedUp ? "marked by you" : null },
      ]
    : [];
  const top = Math.max(1, all?.found ?? 0);
  const sources = (rows ?? []).filter((r) => r.source !== "all" && (r.found || r.replied || r.answeredBack || r.signedUp));
  return (
    <section className="card" style={{ marginBottom: "12px" }} aria-labelledby="funnel-title" data-testid="analytics-funnel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <h2 id="funnel-title">From a thread to a customer</h2>
        <span className="meta">people, not posts · last {days} days</span>
      </div>
      {failed ? <p className="meta">The funnel could not be read. It comes back on the next visit.</p> : null}
      {!rows && !failed ? <p className="meta">Loading…</p> : null}
      {all ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
          {steps.map((s) => (
            <div key={s.label} data-testid="analytics-funnel-step" style={{ display: "grid", gridTemplateColumns: "minmax(0,140px) minmax(0,1fr) minmax(0,180px)", gap: "10px", alignItems: "center" }}>
              <span style={{ fontSize: "13.5px" }}>{s.label}</span>
              <span style={{ height: "10px", borderRadius: "5px", background: "var(--line-2)" }}>
                <span style={{ display: "block", width: `${Math.round((s.n / top) * 100)}%`, height: "10px", borderRadius: "5px", background: "var(--accent)" }}></span>
              </span>
              <span style={{ fontSize: "13.5px" }}>
                <b>{s.n}</b> {s.of ? <span className="meta">· {s.of}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {sources.length ? (
        <div style={{ overflowX: "auto", marginTop: "14px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }} data-testid="analytics-funnel-sources">
            <thead>
              <tr className="meta" style={{ textAlign: "left" }}>
                <th style={{ fontWeight: "500", padding: "4px 0" }}>Source</th>
                <th style={{ fontWeight: "500", textAlign: "right" }}>Found</th>
                <th style={{ fontWeight: "500", textAlign: "right" }}>Replied</th>
                <th style={{ fontWeight: "500", textAlign: "right" }}>Answered back</th>
                <th style={{ fontWeight: "500", textAlign: "right" }}>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((r) => (
                <tr key={r.source} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 0" }}>{SOURCE_LABEL[r.source]}</td>
                  <td style={{ textAlign: "right" }}>{r.found}</td>
                  <td style={{ textAlign: "right" }}>{r.replied}</td>
                  <td style={{ textAlign: "right" }}>{r.answeredBack}</td>
                  <td style={{ textAlign: "right" }}>{r.signedUp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : all && all.found === 0 ? (
        <p className="meta" style={{ marginTop: "8px" }}>
          No one found yet in this range. Sales scans on the days set in Settings › Sales scans, or when you press Scan now.
        </p>
      ) : null}
    </section>
  );
}

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

      <FunnelSection days={range} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "12px", marginBottom: "12px" }} className="td-kpis" role="region" aria-label="Totals">
        <div className="card">
          <div className="meta">{goal?.goal ? `Goal: ${goal.goal}` : "Goal this week"}</div>
          <div className="kpi">
            {goal?.deliverables.done ?? "–"} <span style={{ fontSize: "16px", color: "var(--subtle)", fontWeight: "500" }}>/ {goal?.deliverables.total ?? "–"}</span>
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
