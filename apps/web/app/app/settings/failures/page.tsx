import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, Screen } from "@/components/screens/parts";
import { Panel, TableWrap } from "@/components/ui";
import { ago, displayKey, failureWindow, sourceLabel, warningLabel, WINDOWS, type FailuresReport } from "@/lib/ops/failures";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * What failed for founders (docs/plans/engineering/2026-11-17-web-hardening-round-3-plan.md, session C): work that ended
 * `failed` with the message the founder read, and work stuck past its lease, grouped so one bug is one row. Sentry only
 * sees exceptions. Read under the owner's session: `ops_failures_report` refuses anyone not in `app_owners`, so anyone
 * else gets a 404. Rows carry ids only; the owner looks a founder up in Supabase.
 */
export default async function FailuresPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = failureWindow(raw);
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("ops_failures_report", { p_days: days });
  // Only the owner refusal is a 404; a report that breaks (a timeout, a renamed column) throws, so Sentry sees it.
  if (error?.code === "42501") notFound();
  if (error || !data) throw new Error(`ops_failures_report failed: ${error?.message ?? "no data"}`);
  const report = data as FailuresReport;
  const groups = report.groups;
  // A report from before 20270130010000 has no warnings section.
  const warnings = report.warnings ?? [];
  const now = new Date();

  return (
    <Screen label="Failures">
      <PageHeader
        eyebrow="Owner"
        title={
          report.failures
            ? `${report.failures} ${report.failures === 1 ? "failure" : "failures"} hit ${report.accounts} ${report.accounts === 1 ? "founder" : "founders"} in the last ${days} days.`
            : `Nothing failed for founders in the last ${days} days.`
        }
        sub={
          report.stuck
            ? `${report.stuck} still stuck: running past their lease or time limit. Owner accounts are left out.`
            : "Owner accounts are left out. Stuck work (running past its lease or time limit) counts whatever the window."
        }
      />
      <p className="v2-panel-body">
        {WINDOWS.map((window, i) => (
          <span key={window}>
            {i ? " · " : ""}
            {window === days ? <b>{window} days</b> : <Link href={`/app/settings/failures?days=${window}`}>{window} days</Link>}
          </span>
        ))}
      </p>

      {groups.length ? (
        groups.map((group, i) => (
          <Panel
            key={`${group.source}:${group.kind}:${group.key}`}
            id={`failure-${i}`}
            title={`${sourceLabel(group.source)} · ${group.kind}`}
          >
            <p className="v2-panel-body">
              <b>{displayKey(group.key)}</b>
            </p>
            <p className="v2-panel-body scr-muted">
              {group.accounts} {group.accounts === 1 ? "founder" : "founders"}, {group.failures}{" "}
              {group.failures === 1 ? "time" : "times"}
              {group.stuck ? " (stuck)" : ""}. First {ago(group.first_seen, now)}, last {ago(group.last_seen, now)}.{" "}
              <code>{group.source}</code>
            </p>
            <TableWrap label={`Latest of ${displayKey(group.key)}`}>
              <table className="v2-table scr-table-compact">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Row · founder</th>
                    <th>Error the founder read</th>
                  </tr>
                </thead>
                <tbody>
                  {group.latest.map((row) => (
                    <tr key={row.id}>
                      <td className="scr-num" title={row.at}>
                        {ago(row.at, now)}
                      </td>
                      {/* Both ids in one cell, full and breakable: the owner copies them into Supabase, and a phone keeps room for the error. */}
                      <td style={{ wordBreak: "break-all" }}>
                        <code>{row.id}</code>
                        <br />
                        <code className="scr-muted">{row.user_id}</code>
                      </td>
                      <td>{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        ))
      ) : (
        <Panel id="failures-none" title="Groups">
          <p className="v2-panel-body scr-muted">Nothing failed for founders in this window, and nothing is stuck.</p>
        </Panel>
      )}

      {/* Uploads the worker published with a fallback: they never end `failed`, so they are not in the groups above. */}
      {warnings.length ? (
        warnings.map((warning, i) => (
          <Panel key={warning.code} id={`warning-${i}`} title={`Warning · ${warning.code}`}>
            <p className="v2-panel-body">
              <b>{warningLabel(warning.code)}</b>
            </p>
            <p className="v2-panel-body scr-muted">
              {warning.accounts} {warning.accounts === 1 ? "founder" : "founders"}, {warning.jobs}{" "}
              {warning.jobs === 1 ? "upload" : "uploads"}. First {ago(warning.first_seen, now)}, last{" "}
              {ago(warning.last_seen, now)}. <code>jobs.media_manifest.warnings</code>
            </p>
            <p className="v2-panel-body" style={{ wordBreak: "break-all" }}>
              {/* One id per line: the owner copies them into Supabase. */}
              {warning.latest.map((id, j) => (
                <span key={id}>
                  {j ? <br /> : null}
                  <code>{id}</code>
                </span>
              ))}
            </p>
          </Panel>
        ))
      ) : (
        <Panel id="warnings-none" title="Warnings">
          <p className="v2-panel-body scr-muted">No warnings</p>
        </Panel>
      )}
    </Screen>
  );
}
