"use client";

import { useMemo, useState } from "react";

import { compact, DASH, int, pct, signed, times } from "../format";
import { Kpi, LinkButton, PageHeader, Panel, Screen, Segmented } from "../kit";
import { ANALYTICS_SAMPLE, type AnalyticsScreenData, type Platform } from "./data";

const RANGES = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
] as const;
type Range = (typeof RANGES)[number]["id"];

/** Chart series in stacking order, bottom first. Threads only ever shows as "missing" here. */
const SERIES: { platform: Platform; label: string; color: string }[] = [
  { platform: "x", label: "X", color: "#2b2723" },
  { platform: "tiktok", label: "TikTok", color: "#c93a0f" },
  { platform: "linkedin", label: "LinkedIn", color: "#b9b9aa" },
];

const DOT: Partial<Record<Platform, string>> = {
  x: "#2b2723",
  tiktok: "#c93a0f",
  linkedin: "#b9b9aa",
  threads: "#b23a2e",
  youtube: "#69695d",
};

export function AnalyticsScreen({ data = ANALYTICS_SAMPLE, live = false }: { data?: AnalyticsScreenData; live?: boolean }) {
  const [range, setRange] = useState<Range>("30");
  const [account, setAccount] = useState<string>("all");
  const disconnected = data.accounts.filter((a) => a.stoppedOn);
  const picked = data.accounts.find((a) => a.id === account) ?? null;
  const t = data.totals;

  return (
    <Screen label="Analytics">
      <PageHeader
        eyebrow="Analytics · every connected account"
        title="What worked, and what didn't."
        sub="The Brain reads the same numbers every Sunday and before every plan."
        sample={!live}
        actions={<Segmented label="Range" options={[...RANGES]} value={range} onChange={setRange} />}
      />

      <div role="group" aria-label="Accounts" className="scr-pills">
        <button type="button" className="scr-pill is-plain" aria-pressed={account === "all"} onClick={() => setAccount("all")}>
          All accounts
        </button>
        {data.accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`scr-pill is-plain${a.stoppedOn ? " is-stuck" : ""}`}
            aria-pressed={account === a.id}
            onClick={() => setAccount(a.id)}
          >
            <span className="scr-dot" style={{ background: DOT[a.platform] ?? "#69695d" }} aria-hidden="true" />
            {a.label}
            <span className="scr-tiny scr-num scr-pill-note">{a.synced ?? "reconnect"}</span>
          </button>
        ))}
      </div>

      {disconnected.map((a) => (
        <div key={a.id} role="alert" className="scr-banner is-soft-stuck">
          <p>
            <b>{a.label.split(" · ")[0]} stopped sending data on {a.stoppedOn}.</b> Its numbers after that date are missing,
            and the Brain knows they are missing (not zero).
          </p>
          <LinkButton href="/app/settings" variant="primary">
            Reconnect {a.label.split(" · ")[0]}
          </LinkButton>
        </div>
      ))}

      <section aria-label="Totals" className="scr-kpis">
        <Kpi label="Impressions" value={compact(t.impressions)} note={delta(t.impressionsDelta, " vs previous")} trend={trend(t.impressionsDelta)} />
        <Kpi label="Engagements" value={int(t.engagements)} note={delta(t.engagementsDelta)} trend={trend(t.engagementsDelta)} />
        <Kpi
          label="Engagement rate"
          value={pct(t.engagementRate)}
          note={t.engagementRateDeltaPts == null ? undefined : `${signed(t.engagementRateDeltaPts, (n) => n.toFixed(1))} pts`}
          trend={trend(t.engagementRateDeltaPts)}
        />
        <Kpi
          label="Followers gained"
          value={signed(t.followersGained)}
          note={`across ${data.accounts.length} accounts`}
        />
        <Kpi label="Video views" value={compact(t.videoViews)} note={delta(t.videoViewsDelta)} trend={trend(t.videoViewsDelta)} />
        <Kpi
          label="Posts measured"
          value={String(t.postsMeasured)}
          note={t.postsWithoutData ? `${t.postsWithoutData} without data` : "all reported"}
          trend={t.postsWithoutData ? "down" : undefined}
        />
      </section>

      <div className="scr-split">
        <Panel className="scr-main scr-chart-panel" title="Impressions per day" aside={<Legend />}>
          <DayChart data={data} days={Number(range)} platform={picked?.platform ?? null} />
        </Panel>
        <aside aria-labelledby="learn-title" className="scr-side scr-panel is-dark scr-takeaways">
          <h2 id="learn-title" className="scr-mono">
            What the Brain takes from this
          </h2>
          <div>
            {data.takeaways.map((item) => (
              <p key={item.title}>
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </p>
            ))}
          </div>
          <a href="/app/brain?tab=memory" className="scr-on-dark-link">
            See it in Brain memory →
          </a>
        </aside>
      </div>

      <Panel title="By account" foot="Some platforms don't report every number; a dash means not reported, never zero.">
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Followers</th>
                <th>Change</th>
                <th>Posts</th>
                <th>Median impressions</th>
                <th>Engagement</th>
                <th>Works best</th>
              </tr>
            </thead>
            <tbody>
              {data.byAccount.map((row) => {
                const acc = data.accounts.find((a) => a.id === row.accountId);
                const stuck = !!acc?.stoppedOn;
                return (
                  <tr key={row.accountId} className={stuck ? "is-stuck" : undefined}>
                    <td><b className="scr-strong">{acc?.label ?? row.accountId}</b></td>
                    <td className="scr-num">{int(row.followers)}</td>
                    <td className={`scr-num ${stuck ? "scr-stuck-text" : row.change && row.change > 0 ? "scr-ok-text" : ""}`}>
                      {stuck ? `no data since ${acc?.stoppedOn}` : signed(row.change)}
                    </td>
                    <td className="scr-num">{row.posts}</td>
                    <td className="scr-num">{int(row.medianImpressions)}</td>
                    <td className="scr-num">{pct(row.engagementRate)}</td>
                    <td>{stuck ? <a href="/app/settings">Reconnect</a> : row.worksBest || DASH}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Posts against your own median" aside={<span className="scr-small scr-muted">Best and worst first; every row opens the post</span>}>
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Where</th>
                <th>Impressions</th>
                <th>Engagement</th>
                <th>vs median</th>
                <th>Brain&apos;s read</th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((post) => (
                <tr key={post.id}>
                  <td>{post.href ? <a href={post.href}>{post.title}</a> : post.title}</td>
                  <td>{post.where}</td>
                  <td className="scr-num">{int(post.impressions)}</td>
                  <td className="scr-num">{pct(post.engagementRate)}</td>
                  <td>
                    <span className={`scr-chip ${post.vsMedian == null ? "is-idle" : post.vsMedian >= 1.5 ? "is-posted" : post.vsMedian < 0.8 ? "is-stuck" : "is-scheduled"}`}>
                      {times(post.vsMedian)}
                    </span>
                  </td>
                  <td>{post.read}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Screen>
  );
}

function delta(ratio: number | null, suffix = ""): string | undefined {
  if (ratio == null) return undefined;
  return `${signed(Math.round(ratio * 100))}%${suffix}`;
}

function trend(n: number | null): "up" | "down" | undefined {
  if (n == null || n === 0) return undefined;
  return n > 0 ? "up" : "down";
}

function Legend() {
  return (
    <div className="scr-legend">
      {SERIES.map((s) => (
        <span key={s.platform}>
          <i style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </span>
      ))}
      <span>
        <i className="is-missing" aria-hidden="true" />
        Missing
      </span>
    </div>
  );
}

/**
 * Stacked CSS bars (ui-build plan §4: no chart library). A platform that sent nothing that day is a
 * dashed box of fixed height on top, so a gap never reads as a bad day.
 */
function DayChart({ data, days, platform }: { data: AnalyticsScreenData; days: number; platform: Platform | null }) {
  const bars = useMemo(() => {
    const slice = data.days.slice(-days);
    const shown = (p: Platform) => platform === null || platform === p;
    const rows = slice.map((day) => {
      const parts = SERIES.filter((s) => shown(s.platform)).map((s) => ({ ...s, value: day.values[s.platform] ?? 0 }));
      const missing = Object.entries(day.values)
        .filter(([p, v]) => v === null && shown(p as Platform))
        .map(([p]) => p);
      return { date: day.date, parts, missing, total: parts.reduce((sum, p) => sum + p.value, 0) };
    });
    const max = Math.max(1, ...rows.map((r) => r.total));
    // A missing day gets a box worth 15% of the tallest bar: visible, never mistaken for a total.
    const gap = max * 0.15;
    const top = Math.max(1, ...rows.map((r) => r.total + (r.missing.length ? gap : 0)));
    return rows.map((r) => ({ ...r, gapShare: r.missing.length ? gap / top : 0, scale: top }));
  }, [data.days, days, platform]);

  const total = bars.reduce((sum, b) => sum + b.total, 0);
  const missingDays = bars.filter((b) => b.missing.length).length;
  return (
    <div className="scr-chart">
      <div
        className="scr-bars"
        role="img"
        aria-label={`Impressions per day over ${days} days: ${int(total)} in total${missingDays ? `, ${missingDays} days with missing data` : ""}.`}
        style={{ gap: days > 30 ? 1 : days > 7 ? 4 : 8 }}
      >
        {bars.map((bar) => (
          <div
            key={bar.date}
            className="scr-bar"
            title={`${bar.date}: ${int(bar.total)} impressions${bar.missing.length ? ` · ${bar.missing.join(", ")} missing` : ""}`}
            style={{ height: `${Math.max(0.5, ((bar.total / bar.scale) + bar.gapShare) * 100)}%` }}
          >
            {bar.parts.map((part) =>
              part.value > 0 ? <span key={part.platform} style={{ flexGrow: part.value, background: part.color }} /> : null,
            )}
            {bar.gapShare > 0 && <span className="is-missing" style={{ flexGrow: bar.gapShare * bar.scale }} />}
          </div>
        ))}
      </div>
      <div className="scr-chart-axis">
        <span>{days} days ago</span>
        <span>Today</span>
      </div>
      <p className="scr-tiny scr-muted">
        Dashed red: a platform sent no data that day, counted as missing, not zero. Hover a bar for the day&apos;s numbers.
      </p>
    </div>
  );
}
