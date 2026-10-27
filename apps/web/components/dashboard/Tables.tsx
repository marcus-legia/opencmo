import Link from "next/link";

import { Chip, Panel, Sparkline } from "@/components/ui";

import type { DashboardView, OutgoingRow } from "./model";

export function ResultsPanel({ results, live }: { results: DashboardView["results"]; live: boolean }) {
  return (
    <Panel id="results-title" title="Results · last 7 days" sample={!live} link={{ href: "/app/analytics", label: "Analytics" }}>
      <div className="v2-table-wrap">
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
            {results.rows.map((row) =>
              row.broken ? (
                <tr key={row.account} className="is-stuck">
                  <td className="v2-strong">{row.account}</td>
                  <td colSpan={3} className="v2-stuck-text">
                    {row.broken.note}
                  </td>
                  <td>
                    <Link href={row.broken.href}>Reconnect</Link>
                  </td>
                </tr>
              ) : (
                <tr key={row.account}>
                  <td className="v2-strong">{row.account}</td>
                  <td className="v2-num">{row.impressions ?? "–"}</td>
                  <td>{row.series.length ? <Sparkline values={row.series} tone={row.tone} label={row.trend} /> : "–"}</td>
                  <td className="v2-num v2-ok-text">{row.followers === null ? "–" : `${row.followers >= 0 ? "+" : ""}${row.followers}`}</td>
                  <td className={row.best ? undefined : "v2-muted"}>{row.best ?? "Too few posts to judge"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {results.lesson ? (
        <div className="v2-panel-foot">
          <span className="v2-mark" aria-hidden="true" />
          <span>
            <b>Brain used this:</b> {results.lesson}
          </span>
        </div>
      ) : null}
    </Panel>
  );
}

function Status({ row, waiting }: { row: OutgoingRow; waiting: boolean }) {
  if (row.status === "failed") {
    return (
      <span className="v2-inline">
        <Chip tone="stuck">{row.note ?? "Failed"}</Chip>
        {row.fixHref ? <Link href={row.fixHref}>Fix</Link> : null}
      </span>
    );
  }
  if (row.status === "posted") return <Chip tone="posted">Posted</Chip>;
  if (row.status === "waiting" && waiting) return <Chip tone="waiting">Time waits on you</Chip>;
  return <Chip tone="scheduled">Scheduled</Chip>;
}

export function TodayPanel({ rows, live, waiting }: { rows: OutgoingRow[]; live: boolean; waiting: (cardId: string) => boolean }) {
  return (
    <Panel id="today-title" title="Going out today" sample={!live} link={{ href: "/app/schedule", label: "Calendar" }}>
      {rows.length === 0 ? (
        <p className="v2-panel-body v2-muted">Nothing goes out today.</p>
      ) : (
        <div className="v2-table-wrap">
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
                  <td className="v2-num">{row.time}</td>
                  <td>{row.where}</td>
                  <td>{row.what}</td>
                  <td>
                    <Status row={row} waiting={row.cardId !== null && waiting(row.cardId)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
