import Link from "next/link";

import { Chip, Panel, Sparkline, TableWrap } from "@/components/ui";
import { PLATFORM_LABEL, type Where } from "@/lib/screens/common";
import type { DashboardScreen } from "@/lib/screens/dashboard";

type Row = DashboardScreen["results"]["rows"][number];
type Out = DashboardScreen["outToday"][number];

const where = (w: Where) => `${PLATFORM_LABEL[w.platform]} · ${w.handle}`;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const hourMinute = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** "Rising", "Falling" or "Flat" over the days that reported; a flat line gets the quiet bar colour. */
function trend(series: (number | null)[]): { label: string; tone: "ink" | "flat" } {
  const days = series.filter((v): v is number => v !== null);
  if (days.length < 2) return { label: "Too few days to judge", tone: "flat" };
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (last > first * 1.2) return { label: "Rising", tone: "ink" };
  if (last < first * 0.8) return { label: "Falling", tone: "ink" };
  return { label: "Flat", tone: "flat" };
}

export function ResultsPanel({ results, live }: { results: DashboardScreen["results"]; live: boolean }) {
  return (
    <Panel id="results-title" title="Results · last 7 days" sample={!live} link={{ href: "/app/analytics", label: "Analytics" }}>
      {results.rows.length === 0 ? (
        <p className="v2-panel-body v2-muted">Numbers show up here once a connected account reports them.</p>
      ) : (
        <TableWrap label="Results by account">
          <table className="v2-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Impressions</th>
                <th scope="col">Last 7 days</th>
                <th scope="col">Followers</th>
                <th scope="col">Best post</th>
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row: Row) => {
                const name = where(row.where);
                if (row.noDataSince) {
                  return (
                    <tr key={name} className="is-stuck">
                      <td className="v2-strong">{name}</td>
                      <td colSpan={3} className="v2-stuck-text">
                        No data since {dayMonth(row.noDataSince)}: reconnect to resume
                      </td>
                      <td>
                        <Link href="/app/settings">Reconnect</Link>
                      </td>
                    </tr>
                  );
                }
                const t = trend(row.series);
                return (
                  <tr key={name}>
                    <td className="v2-strong">{name}</td>
                    <td className="v2-num">{row.impressions === null ? "–" : compact.format(row.impressions)}</td>
                    <td>
                      <Sparkline values={row.series} tone={t.tone} label={t.label} />
                    </td>
                    <td className="v2-num v2-ok-text">{row.followers === null ? "–" : `${row.followers >= 0 ? "+" : ""}${row.followers}`}</td>
                    <td className={row.best ? undefined : "v2-muted"}>{row.best ?? "Too few posts to judge"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {results.brainUsed ? (
        <div className="v2-panel-foot">
          <span className="v2-mark" aria-hidden="true" />
          <span>
            <b>Brain used this:</b> {results.brainUsed.lessons} {results.brainUsed.lessons === 1 ? "lesson" : "lessons"} for next week.{" "}
            {results.brainUsed.text}
          </span>
        </div>
      ) : null}
    </Panel>
  );
}

function Status({ row, waiting }: { row: Out; waiting: boolean }) {
  switch (row.status) {
    case "failed":
      return (
        <span className="v2-inline">
          <Chip tone="stuck">{row.problem ? `Failed: ${row.problem}` : "Failed"}</Chip>
          <Link href="/app/settings">Fix</Link>
        </span>
      );
    case "posted":
      return <Chip tone="posted">Posted</Chip>;
    case "waiting_founder":
      // Once its card is decided on this screen, the row stops waiting before the next read confirms it.
      return waiting ? <Chip tone="waiting">Time waits on you</Chip> : <Chip tone="scheduled">Scheduled</Chip>;
    case "proposed":
      return <Chip tone="idle">Proposed</Chip>;
    default:
      return <Chip tone="scheduled">Scheduled</Chip>;
  }
}

export function TodayPanel({ rows, live, waiting }: { rows: Out[]; live: boolean; waiting: (cardId: string) => boolean }) {
  return (
    <Panel id="today-title" title="Going out today" sample={!live} link={{ href: "/app/schedule", label: "Calendar" }}>
      {rows.length === 0 ? (
        <p className="v2-panel-body v2-muted">Nothing goes out today.</p>
      ) : (
        <TableWrap label="Going out today">
          <table className="v2-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Where</th>
                <th scope="col">What</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="v2-num">{hourMinute(row.at)}</td>
                  <td>{where(row.where)}</td>
                  <td>{row.text}</td>
                  <td>
                    <Status row={row} waiting={row.approvalId === null || waiting(row.approvalId)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}
