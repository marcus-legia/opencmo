"use client";

import { useMemo, useState } from "react";

import type { AnalyticsScreen as Data } from "@/lib/screens/analytics";
import { PLATFORM_LABEL, type Account, type Platform } from "@/lib/screens/common";

import { ago, compact, DASH, int, percent, shortDate, signed, times } from "../format";
import { EmptyState, ErrorNote, Kpi, LinkButton, PageHeader, Panel, Screen, Segmented, SkeletonBlocks } from "../kit";
import { isSample, useScreen } from "../useScreen";

const RANGES = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
] as const;
type Range = (typeof RANGES)[number]["id"];

/** Chart series in stacking order, bottom first; other platforms count only in the totals. */
const SERIES: { platform: Platform; color: string }[] = [
  { platform: "x", color: "#2b2723" },
  { platform: "tiktok", color: "#c93a0f" },
  { platform: "linkedin", color: "#b9b9aa" },
];

const DOT: Partial<Record<Platform, string>> = {
  x: "#2b2723",
  tiktok: "#c93a0f",
  linkedin: "#b9b9aa",
  threads: "#b23a2e",
  youtube: "#69695d",
};

const KPI_LABEL: Record<Data["kpis"][number]["key"], string> = {
  impressions: "Impressions",
  engagements: "Engagements",
  engagement_rate: "Engagement rate",
  followers: "Followers gained",
  video_views: "Video views",
  posts_measured: "Posts measured",
};

const accountLabel = (a: { platform: Platform; handle: string }) => `${PLATFORM_LABEL[a.platform]} · ${a.handle}`;

export function AnalyticsScreen() {
  const [range, setRange] = useState<Range>("30");
  const [state] = useScreen("analytics", { range });

  return (
    <Screen label="Analytics">
      <PageHeader
        eyebrow="Analytics · every connected account"
        title="What worked, and what didn't."
        sub="The Brain reads the same numbers every Sunday and before every plan."
        sample={state.status === "ready" && isSample(state.live)}
        actions={<Segmented label="Range" options={[...RANGES]} value={range} onChange={setRange} />}
      />
      {state.status === "loading" && <SkeletonBlocks />}
      {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      {state.status === "ready" && <AnalyticsBody data={state.data} days={Number(range)} />}
    </Screen>
  );
}

function AnalyticsBody({ data, days }: { data: Data; days: number }) {
  const [accountId, setAccountId] = useState<string>("all");
  const picked = data.accounts.find((a) => a.id === accountId) ?? null;
  const stopped = data.accounts.filter((a) => a.status === "reconnect");

  if (!data.accounts.length) {
    return (
      <EmptyState action={<LinkButton href="/app/settings" variant="primary">Connect an account</LinkButton>}>
        No accounts connected yet. Numbers show here after your first posts go out.
      </EmptyState>
    );
  }

  return (
    <>
      <div role="group" aria-label="Accounts" className="scr-pills">
        <button type="button" className="scr-pill is-plain" aria-pressed={accountId === "all"} onClick={() => setAccountId("all")}>
          All accounts
        </button>
        {data.accounts.map((a) => (
          <AccountPill key={a.id} account={a} pressed={accountId === a.id} onPick={() => setAccountId(a.id)} />
        ))}
      </div>

      {stopped.map((a) => (
        <div key={a.id} role="alert" className="scr-banner is-soft-stuck">
          <p>
            <b>
              {PLATFORM_LABEL[a.platform]} stopped sending data on {shortDate(a.noDataSince ?? a.syncedAt)}.
            </b>{" "}
            Its numbers after that date are missing, and the Brain knows they are missing (not zero).
          </p>
          <LinkButton href="/app/settings" variant="primary">
            Reconnect {PLATFORM_LABEL[a.platform]}
          </LinkButton>
        </div>
      ))}

      <section aria-label="Totals" className="scr-kpis">
        {data.kpis.map((k) => (
          <Kpi key={k.key} label={KPI_LABEL[k.key]} {...kpiText(k)} />
        ))}
      </section>

      <div className="scr-split">
        <Panel className="scr-main scr-chart-panel" title="Impressions per day" aside={<Legend />}>
          <DayChart daily={data.daily} days={days} platform={picked?.platform ?? null} />
        </Panel>
        {data.brainReads.length > 0 && (
          <aside aria-labelledby="learn-title" className="scr-side scr-panel is-dark scr-takeaways">
            <h2 id="learn-title" className="scr-mono">
              What the Brain takes from this
            </h2>
            <div>
              {data.brainReads.map((item) => (
                <p key={item.text}>
                  <b>{item.text}</b>
                  <span>{[item.evidence, item.feeds].filter(Boolean).join(" · ")}</span>
                </p>
              ))}
            </div>
            <a href="/app/brain?tab=memory" className="scr-on-dark-link">
              See it in Brain memory →
            </a>
          </aside>
        )}
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
                const stuck = !!row.noDataSince;
                return (
                  <tr key={`${row.where.platform}-${row.where.handle}`} className={stuck ? "is-stuck" : undefined}>
                    <td>
                      <b className="scr-strong">{accountLabel(row.where)}</b>
                    </td>
                    <td className="scr-num">{int(row.followers)}</td>
                    <td className={`scr-num ${stuck ? "scr-stuck-text" : row.change && row.change > 0 ? "scr-ok-text" : ""}`}>
                      {stuck ? `no data since ${shortDate(row.noDataSince)}` : signed(row.change)}
                    </td>
                    <td className="scr-num">{row.posts}</td>
                    <td className="scr-num">{int(row.medianImpressions)}</td>
                    <td className="scr-num">{percent(row.engagementRate)}</td>
                    <td>{stuck ? <a href="/app/settings">Reconnect</a> : (row.worksBest ?? DASH)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {data.posts.length > 0 && (
        <Panel
          title="Posts against your own median"
          aside={<span className="scr-small scr-muted">Best and worst first; every row opens the post</span>}
        >
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
                    <td>
                      {post.url ? (
                        <a href={post.url} target="_blank" rel="noopener noreferrer">
                          {post.title}
                        </a>
                      ) : (
                        post.title
                      )}
                    </td>
                    <td>{PLATFORM_LABEL[post.platform]}</td>
                    <td className="scr-num">{int(post.impressions)}</td>
                    <td className="scr-num">{percent(post.engagementRate)}</td>
                    <td>
                      <span className={`scr-chip ${medianTone(post.vsMedian)}`}>{times(post.vsMedian)}</span>
                    </td>
                    <td>{post.read ?? DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

function AccountPill({ account, pressed, onPick }: { account: Account; pressed: boolean; onPick: () => void }) {
  const stuck = account.status === "reconnect";
  return (
    <button type="button" className={`scr-pill is-plain${stuck ? " is-stuck" : ""}`} aria-pressed={pressed} onClick={onPick}>
      <span className="scr-dot" style={{ background: DOT[account.platform] ?? "#69695d" }} aria-hidden="true" />
      {accountLabel(account)}
      <span className="scr-pill-note">
        {stuck ? "reconnect" : account.status === "not_connected" ? "not connected" : `synced ${ago(account.syncedAt)}`}
      </span>
    </button>
  );
}

function kpiText(k: Data["kpis"][number]): { value: string; note?: string; trend?: "up" | "down" } {
  const value =
    k.key === "engagement_rate"
      ? percent(k.value)
      : k.key === "followers"
        ? signed(k.value)
        : k.key === "posts_measured"
          ? int(k.value)
          : k.key === "engagements"
            ? int(k.value)
            : compact(k.value);
  if (k.change != null) {
    const note =
      k.changeUnit === "points" ? `${signed(k.change, (n) => n.toFixed(1))} pts` : `${signed(k.change)}%${k.key === "impressions" ? " vs previous" : ""}`;
    return { value, note, trend: k.change > 0 ? "up" : k.change < 0 ? "down" : undefined };
  }
  // A note about missing data is a warning; any other note is neutral.
  return { value, note: k.note ?? undefined, trend: k.note && /without data|missing/.test(k.note) ? "down" : undefined };
}

function medianTone(vs: number | null): string {
  if (vs == null) return "is-idle";
  if (vs >= 1.5) return "is-posted";
  if (vs < 0.8) return "is-stuck";
  return "is-scheduled";
}

function Legend() {
  return (
    <div className="scr-legend">
      {SERIES.map((s) => (
        <span key={s.platform}>
          <i style={{ background: s.color }} aria-hidden="true" />
          {PLATFORM_LABEL[s.platform]}
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
 * Stacked CSS bars (ui-build plan §4: no chart library). A platform that sent nothing that day is a dashed box on
 * top, so a gap never reads as a bad day.
 */
function DayChart({ daily, days, platform }: { daily: Data["daily"]; days: number; platform: Platform | null }) {
  const bars = useMemo(() => {
    const shown = (p: Platform) => platform === null || platform === p;
    const rows = daily.slice(-days).map((d) => {
      const parts = SERIES.filter((s) => shown(s.platform)).map((s) => ({ ...s, value: d.values[s.platform] ?? 0 }));
      const missing = (Object.entries(d.values) as [Platform, number | null][])
        .filter(([p, v]) => v === null && shown(p))
        .map(([p]) => PLATFORM_LABEL[p]);
      return { day: d.day, parts, missing, total: parts.reduce((sum, p) => sum + p.value, 0) };
    });
    const max = Math.max(1, ...rows.map((r) => r.total));
    // A missing day gets a box worth 15% of the tallest bar: visible, never mistaken for a total.
    const gap = max * 0.15;
    const top = Math.max(1, ...rows.map((r) => r.total + (r.missing.length ? gap : 0)));
    return rows.map((r) => ({ ...r, gap: r.missing.length ? gap : 0, top }));
  }, [daily, days, platform]);

  if (!bars.length) return <p className="scr-panel-body scr-muted">No numbers in this range yet.</p>;

  const total = bars.reduce((sum, b) => sum + b.total, 0);
  const missingDays = bars.filter((b) => b.missing.length).length;
  return (
    <div className="scr-chart">
      <div
        className="scr-bars"
        role="img"
        aria-label={`Impressions per day over ${bars.length} days: ${int(total)} in total${missingDays ? `, ${missingDays} days with missing data` : ""}.`}
        style={{ gap: bars.length > 30 ? 1 : bars.length > 7 ? 4 : 8 }}
      >
        {bars.map((bar) => (
          <div
            key={bar.day}
            className="scr-bar"
            title={`${bar.day}: ${int(bar.total)} impressions${bar.missing.length ? ` · ${bar.missing.join(", ")} missing` : ""}`}
            style={{ height: `${Math.max(0.5, ((bar.total + bar.gap) / bar.top) * 100)}%` }}
          >
            {bar.parts.map((part) => (part.value > 0 ? <span key={part.platform} style={{ flexGrow: part.value, background: part.color }} /> : null))}
            {bar.gap > 0 && <span className="is-missing" style={{ flexGrow: bar.gap }} />}
          </div>
        ))}
      </div>
      <div className="scr-chart-axis">
        <span>{bars.length} days ago</span>
        <span>Today</span>
      </div>
      <p className="scr-tiny scr-muted">
        Dashed red: a platform sent no data that day, counted as missing, not zero. Hover a bar for the day&apos;s numbers.
      </p>
    </div>
  );
}
