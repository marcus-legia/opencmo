"use client";

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { rate, type FunnelRow } from "@/lib/cmo/funnel-view";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { BEST_HOURS, type Range } from "@/lib/screens/analytics";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import { PageHeader } from "./PageHeader";
import { hasLogo, PlatformMark } from "./platform-logos";

const RANGES: { id: Range; label: string; title: string; compare: string }[] = [
  { id: 7, label: "Week", title: "This week", compare: "compared with the same days last week" },
  { id: 30, label: "Month", title: "This month", compare: "compared with the 30 days before" },
  { id: 90, label: "90 days", title: "Last 90 days", compare: "compared with the 90 days before" },
];

const n = new Intl.NumberFormat("en-US");
const dayName = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const postDay = (iso: string | undefined) => (iso ? new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(iso)) : null);
const unquote = (t: string) => t.replace(/^[“"]|[”"]$/g, "");
/** "Mon 23 – Sun 29 Nov": the range as Calendar writes a week. */
function rangeText(first: string, last: string): string {
  const a = new Date(`${first}T12:00:00Z`);
  const b = new Date(`${last}T12:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", ...(sameMonth ? {} : { month: "short" }), timeZone: "UTC" }).format(a);
  const right = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(b);
  return `${left} – ${right}`;
}

const SOURCE_LABEL: Record<FunnelRow["source"], string> = { all: "All sources", reddit: "Reddit", hn: "Hacker News", facebook: "Facebook groups", threads: "Threads" };

/**
 * From a thread to a customer (wave 3, canvas board Analytics): found → replied → answered back → signed up over the
 * range, then the same per source. Rates are shown only where there is something to divide by. One hue: the bars are
 * sizes of one thing, not four series.
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
    <section className="ui-card" aria-labelledby="funnel-title" data-testid="analytics-funnel">
      <div className="ui-card__head">
        <h2 id="funnel-title">From a thread to a customer</h2>
        <span className="ui-t-xs ui-muted">People, not posts · last {days} days</span>
      </div>
      {failed ? <p className="ui-t-sm ui-muted uip-flat">The funnel could not be read. It comes back on the next visit.</p> : null}
      {!rows && !failed ? <p className="ui-t-sm ui-muted uip-flat">Loading…</p> : null}
      {all ? (
        <ol className="uip-funnel">
          {steps.map((s) => (
            <li key={s.label} data-testid="analytics-funnel-step" className="uip-funnel__step">
              <span className="uip-funnel__label">{s.label}</span>
              <span className="uip-funnel__track" aria-hidden="true">
                <span style={{ width: `${Math.max(s.n ? 2 : 0, Math.round((s.n / top) * 100))}%` }} />
              </span>
              <span className="uip-funnel__value ui-num">
                <b>{s.n}</b>
                {s.of ? <span className="ui-muted"> · {s.of}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {sources.length ? (
        <div className="uip-tablewrap">
          <table className="uip-table" data-testid="analytics-funnel-sources">
            <caption className="sr-only">By source</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Found</th>
                <th scope="col">Replied</th>
                <th scope="col">Answered back</th>
                <th scope="col">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((r) => (
                <tr key={r.source}>
                  <th scope="row">
                    <span className="uip-source">
                      {hasLogo(r.source) ? <PlatformMark platform={r.source} size={16} /> : null}
                      {SOURCE_LABEL[r.source]}
                    </span>
                  </th>
                  <td>{r.found}</td>
                  <td>{r.replied}</td>
                  <td>{r.answeredBack}</td>
                  <td>{r.signedUp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : all && all.found === 0 ? (
        <p className="ui-t-sm ui-muted uip-flat" style={{ marginTop: "var(--sp-3)" }}>
          No one found yet in this range. Sales scans on the days set in Settings › Sales scans, or when you press Scan now.
        </p>
      ) : null}
    </section>
  );
}

type Point = { day: string; value: number | null; future: boolean };

/** Views per day as thin bars from one baseline; a day with no reading is a dashed stub, a day still to come is blank. */
function DayBars({ points, platformLabel }: { points: Point[]; platformLabel: string }) {
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  const best = points.reduce<Point | null>((b, p) => ((p.value ?? -1) > (b?.value ?? -1) ? p : b), null);
  const dense = points.length > 14;
  return (
    <div className="uip-bars" data-dense={dense ? "" : undefined} role="img" aria-label={`Views per day on ${platformLabel}: ${points.filter((p) => !p.future).map((p) => `${dayName(p.day)} ${dayShort(p.day)} ${p.value === null ? "no data" : n.format(p.value)}`).join(", ")}`}>
      <div className="uip-bars__plot">
        {points.map((p) => {
          const tip = p.future ? `${dayName(p.day)} ${dayShort(p.day)}: still to come` : `${dayName(p.day)} ${dayShort(p.day)}: ${p.value === null ? "no reading" : `${n.format(p.value)} views`}`;
          return (
            <span key={p.day} className="uip-bars__col" title={tip} data-state={p.future ? "future" : p.value === null ? "missing" : p === best && p.value ? "best" : undefined}>
              {!dense && p === best && p.value ? <span className="uip-bars__label ui-num">{n.format(p.value)}</span> : null}
              <span className="uip-bars__bar" style={{ height: p.value ? `${Math.max(2, Math.round((p.value / max) * 100))}%` : undefined }} />
            </span>
          );
        })}
      </div>
      <div className="uip-bars__axis" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.day}>{dense ? (i === 0 || i === points.length - 1 || i % 7 === 0 ? dayShort(p.day) : "") : dayName(p.day)}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Analytics (Analytics.dc.html): the week against the same days of the last, views per day, the best times to post,
 * what worked and the competitors' outliers. Numbers come from the connected accounts (`/screens/analytics`), the goal
 * from the feed, the replies from Sales and the outliers from Research; a block without data says so instead of
 * drawing zeros. The week is Monday to Sunday in the founder's zone, as Calendar draws it.
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
  // The chart draws one platform (X first): views from two networks are not one series.
  const platform = days.some((d) => typeof d.values.x === "number") ? "x" : (Object.keys(days.find((d) => Object.keys(d.values).length)?.values ?? {})[0] as keyof typeof PLATFORM_LABEL | undefined);
  // The week's later days are in `daily` (Monday to Sunday, the founder's zone) with nothing measured yet: blank, not
  // "no data". `en-CA` writes the browser's local date as YYYY-MM-DD.
  const localToday = new Date().toLocaleDateString("en-CA");
  const points: Point[] = days.map((d) => ({ day: d.day, value: platform ? (d.values[platform] ?? null) : null, future: d.day > localToday && !Object.keys(d.values).length }));
  const best = points.reduce<Point | null>((b, p) => ((p.value ?? -1) > (b?.value ?? -1) ? p : b), null);
  const impressions = kpi("impressions");
  const goal = dash.status === "ready" ? (dash.data as { week: { goal: string | null; deliverables: { done: number; total: number } } }).week : null;
  const replied = sales.status === "ready" ? (sales.data as { week: { replied: number; dismissed: number } }).week : null;
  const posts = data?.posts ?? [];
  const outliers =
    research.status === "ready"
      ? (research.data as { insights: { id: string; type: string; scope: string; platform: string; text: string; evidence: string; sources: string[]; video?: { outlier: number | null } }[] }).insights.filter((i) => i.scope === "competitors").slice(0, 3)
      : [];
  const measuredPosts = kpi("posts_measured");
  // Every post that went out, measured or not, so it agrees with the views next to it (it read 0 beside 49 views).
  const published = data ? (data.published ?? measuredPosts?.value ?? null) : null;
  const unmeasured = published !== null && measuredPosts?.value != null ? published - measuredPosts.value : 0;
  const goalPct = goal && goal.deliverables.total ? Math.round((goal.deliverables.done / goal.deliverables.total) * 100) : 0;

  return (
    <main className="uip uip-analytics" data-testid="v2-analytics">
      <PageHeader
        title={meta.title}
        status={`${days.length ? `${rangeText(days[0]!.day, days[days.length - 1]!.day)} · ` : ""}${meta.compare}`}
        actions={
          <div className="ui-seg" role="tablist" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" role="tab" aria-selected={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="uip-kpis" role="region" aria-label="Totals">
        <div className="ui-card uip-kpi">
          <span className="uip-kpi__label">{goal?.goal ? `Goal: ${goal.goal}` : "Goal this week"}</span>
          <span className="uip-kpi__value ui-num">
            {goal?.deliverables.done ?? "–"} <span className="uip-kpi__of">/ {goal?.deliverables.total ?? "–"}</span>
          </span>
          <span className="ui-meter" role="meter" aria-label="Goal done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPct}>
            <span style={{ width: `${goalPct}%` }} />
          </span>
        </div>
        <div className="ui-card uip-kpi">
          <span className="uip-kpi__label">Views</span>
          <span className="uip-kpi__value ui-num">{impressions?.value != null ? n.format(impressions.value) : "–"}</span>
          {impressions?.change != null ? (
            <span className="uip-kpi__note ui-num" data-tone={impressions.change >= 0 ? "ok" : undefined}>
              {impressions.change >= 0 ? "+" : "−"}
              {Math.abs(Math.round(impressions.change))}% {range === 7 ? "vs the same days last week" : "vs the period before"}
            </span>
          ) : (
            <span className="uip-kpi__note">Nothing to compare yet</span>
          )}
        </div>
        <div className="ui-card uip-kpi">
          <span className="uip-kpi__label">Posts published</span>
          <span className="uip-kpi__value ui-num">{published ?? "–"}</span>
          <span className="uip-kpi__note">{unmeasured > 0 ? `${unmeasured} still waiting for numbers` : published ? "All measured" : " "}</span>
        </div>
        <div className="ui-card uip-kpi">
          <span className="uip-kpi__label">Replies</span>
          <span className="uip-kpi__value ui-num">{replied?.replied ?? "–"}</span>
          <span className="uip-kpi__note">{replied ? `${replied.dismissed} dismissed this week` : " "}</span>
        </div>
      </div>

      <FunnelSection days={range} />

      <div className="uip-grid uip-grid--wide">
        <section className="ui-card" aria-labelledby="views-title">
          <div className="ui-card__head">
            <h2 id="views-title">Views per day</h2>
            <span className="ui-t-xs ui-muted">{platform ? `${PLATFORM_LABEL[platform]}, all posts` : "No account reports yet"}</span>
          </div>
          {platform ? (
            <DayBars points={points} platformLabel={PLATFORM_LABEL[platform]} />
          ) : (
            <p className="ui-t-sm ui-muted uip-flat">Connect X, LinkedIn or Threads in Settings and their daily views show here.</p>
          )}
          {best?.value && posts[0] ? (
            <p className="ui-t-sm ui-muted uip-flat" style={{ marginTop: "var(--sp-3)" }}>
              {dayName(best.day)} was the best day of the {range === 7 ? "week" : "range"}. Top post: “{unquote(posts[0].title)}”
              {posts[0].impressions != null ? `, ${n.format(posts[0].impressions)} views` : ""}.
            </p>
          ) : null}
        </section>
        <section className="ui-card" aria-labelledby="times-title">
          <div className="ui-card__head">
            <h2 id="times-title">Best times to post</h2>
            <span className="ui-t-xs ui-muted">From your posts in this range</span>
          </div>
          {data?.bestTimes ? (
            <>
              <div className="uip-heat" role="img" aria-label="Best posting times by day and hour. Darker means more views per post than your median.">
                <span />
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <span key={d} className="uip-heat__day">
                    {d.slice(0, 1)}
                  </span>
                ))}
                {BEST_HOURS.map((h, row) => (
                  <span key={h} style={{ display: "contents" }}>
                    <span className="uip-heat__hour ui-num">{String(h).padStart(2, "0")}:00</span>
                    {data.bestTimes![row]!.map((level, col) => (
                      <span key={col} className="uip-heat__cell" data-level={level} title={`${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][col]} ${String(h).padStart(2, "0")}:00: ${["no post", "below your median", "about your median", "well above your median"][level]}`} />
                    ))}
                  </span>
                ))}
              </div>
              <div className="uip-heat__legend ui-t-xs ui-muted" aria-hidden="true">
                Fewer views
                {[1, 2, 3].map((l) => (
                  <span key={l} className="uip-heat__cell" data-level={l} />
                ))}
                More
              </div>
            </>
          ) : (
            <p className="ui-t-sm ui-muted uip-flat">Shows once three of your posts have reported their views.</p>
          )}
        </section>
      </div>

      <div className="uip-grid">
        <section className="ui-card" aria-labelledby="worked-title">
          <div className="ui-card__head">
            <h2 id="worked-title">What worked</h2>
            <span className="ui-t-xs ui-muted">Your posts, by views</span>
          </div>
          {posts.length === 0 ? <p className="ui-t-sm ui-muted uip-flat">Your best and worst posts show here once they report.</p> : null}
          <ul className="uip-list">
            {posts.slice(0, 3).map((p) => {
              const worse = p.vsMedian !== null && p.vsMedian < 1;
              return (
                <li key={p.id} className="uip-list__row">
                  <span className="ui-chip ui-num" data-tone={worse ? undefined : "ok"}>
                    {p.vsMedian !== null ? `${p.vsMedian}×` : "–"}
                  </span>
                  <span className="uip-list__main">
                    <span className="uip-list__title">{unquote(p.title)}</span>
                    <span className="ui-t-xs ui-muted">{[PLATFORM_LABEL[p.platform], postDay(p.publishedAt), p.impressions != null ? `${n.format(p.impressions)} views` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost ui-btn--sm"
                    onClick={() => {
                      focusChat();
                      fillChat(worse ? `Why did "${p.title}" do worse than usual?` : `Plan more posts like "${p.title}".`);
                    }}
                  >
                    {worse ? "Ask why" : "Plan more like this"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="ui-card" aria-labelledby="outliers-title">
          <div className="ui-card__head">
            <h2 id="outliers-title">Competitors&apos; outliers</h2>
            <span className="ui-t-xs ui-muted">From Research</span>
          </div>
          {outliers.length === 0 ? <p className="ui-t-sm ui-muted uip-flat">Research adds what works for your competitors after its next run.</p> : null}
          <ul className="uip-list">
            {outliers.map((o) => (
              <li key={o.id} className="uip-list__row">
                <span className="ui-chip ui-num">{o.video?.outlier ? `${o.video.outlier}×` : o.type}</span>
                <span className="uip-list__main">
                  <a href={o.sources[0]} target="_blank" rel="noopener noreferrer" className="uip-list__title">
                    {o.text}
                  </a>
                  <span className="ui-t-xs ui-muted">{o.evidence}</span>
                </span>
                <button
                  type="button"
                  className="ui-btn ui-btn--ghost ui-btn--sm"
                  onClick={() => {
                    focusChat();
                    fillChat(`Write a post using this ${o.type}: ${o.text}`);
                  }}
                >
                  Use this {o.type === "idea" ? "idea" : o.type}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
