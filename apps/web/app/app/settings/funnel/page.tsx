import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, Screen } from "@/components/screens/parts";
import { Panel, TableWrap } from "@/components/ui";
import { funnelRows, pct, WINDOWS, type FunnelReport } from "@/lib/ops/funnel";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The CMO funnel for the owner (docs/plans/engineering/2026-11-15-cmo-funnel-plan.md): of the accounts that signed up in
 * the window, how many read their website, approved a card, scheduled, posted and pay. Read under the owner's session:
 * `cmo_funnel_report` refuses anyone not in `app_owners`, so the page shows nothing to anyone else.
 */
export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = WINDOWS.includes(Number(raw) as (typeof WINDOWS)[number]) ? Number(raw) : 30;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("cmo_funnel_report", { p_days: days });
  if (error || !data) notFound();
  const report = data as FunnelReport;
  const rows = funnelRows(report);
  const signedUp = rows[0]?.users ?? 0;
  const approved = rows.find((row) => row.step === "approved")?.users ?? 0;
  const paid = rows.find((row) => row.step === "paid")?.users ?? 0;
  const active = report.active_7d;

  return (
    <Screen label="Funnel">
      <PageHeader
        eyebrow="Owner"
        title={`${signedUp} signed up in the last ${days} days.`}
        sub={`${pct(approved, signedUp)} approved a first card, ${pct(paid, signedUp)} pay.`}
      />
      <p className="v2-panel-body">
        {WINDOWS.map((window, i) => (
          <span key={window}>
            {i ? " · " : ""}
            {window === days ? <b>{window} days</b> : <Link href={`/app/settings/funnel?days=${window}`}>{window} days</Link>}
          </span>
        ))}
      </p>

      <Panel id="funnel-steps" title="Steps">
        <TableWrap label="Funnel steps">
          <table className="v2-table scr-table-compact">
            <thead>
              <tr>
                <th>Step</th>
                <th>Founders</th>
                <th>Of sign-ups</th>
                <th>Of the step before</th>
                <th>Median time from sign-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.step}>
                  <td>{row.label}</td>
                  <td className="scr-num">{row.users}</td>
                  <td className="scr-num">{pct(row.users, signedUp)}</td>
                  <td className="scr-num">{row.previous === null ? "—" : pct(row.users, row.previous)}</td>
                  <td className="scr-num">{row.median ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel id="funnel-active" title="Active this week">
        <p className="v2-panel-body">
          Of the founders who signed up at least 7 days ago, {active.active} of {active.eligible} ({pct(active.active, active.eligible)}) approved a
          card in the last 7 days. Paying founders: {active.paid_active} of {active.paid_eligible} ({pct(active.paid_active, active.paid_eligible)}).
        </p>
      </Panel>

      <Panel id="funnel-channels" title="By channel (first touch)">
        {report.by_channel?.length ? (
          <TableWrap label="By channel">
            <table className="v2-table scr-table-compact">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Signed up</th>
                  <th>Free scan</th>
                  <th>Found someone</th>
                  <th>Pay</th>
                </tr>
              </thead>
              <tbody>
                {report.by_channel.map((row) => (
                  <tr key={row.channel}>
                    <td>{row.channel}</td>
                    <td className="scr-num">{row.signed_up}</td>
                    <td className="scr-num">{row.free_scan}</td>
                    <td className="scr-num">{row.found}</td>
                    <td className="scr-num">{row.paid} ({pct(row.paid, row.signed_up)})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="v2-panel-body scr-muted">No sign-ups with a channel in this window. Links with ?ref= or utm_source are counted from the first visit.</p>
        )}
      </Panel>

      <Panel id="funnel-weeks" title="By week of sign-up">
        {report.by_week.length ? (
          <TableWrap label="By week of sign-up">
            <table className="v2-table scr-table-compact">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Signed up</th>
                  <th>Onboarded</th>
                  <th>Approved</th>
                  <th>Posted</th>
                  <th>Pay</th>
                </tr>
              </thead>
              <tbody>
                {report.by_week.map((week) => (
                  <tr key={week.week}>
                    <td>{week.week}</td>
                    <td className="scr-num">{week.signed_up}</td>
                    <td className="scr-num">{week.onboarded}</td>
                    <td className="scr-num">{week.approved}</td>
                    <td className="scr-num">{week.posted}</td>
                    <td className="scr-num">{week.paid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="v2-panel-body scr-muted">Nobody signed up in this window.</p>
        )}
      </Panel>
    </Screen>
  );
}
