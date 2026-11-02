import { notFound } from "next/navigation";

import { PageHeader, Screen } from "@/components/screens/parts";
import { Panel, TableWrap } from "@/components/ui";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * What OpenCMO pays its providers (docs/plans/cmo/2026-11-02-provider-spend-ledger-plan.md), for the owner only. The
 * report is read under the owner's own session: `provider_spend_report` refuses anyone not in `app_owners`, so this
 * page needs no service role and shows nothing to anyone else.
 */
type Row = { provider?: string; kind?: string; email?: string; micro_usd: number; calls?: number };
type Report = {
  since: string;
  total_micro_usd: number;
  unpriced_calls: number;
  by_provider: Row[];
  by_kind: Row[];
  top_founders: Row[];
  approved_cards: number;
  micro_usd_per_approved: number | null;
};

const usd = (micro: number | null | undefined) => (micro == null ? "—" : `$${(micro / 1e6).toFixed(micro < 10_000 ? 4 : 2)}`);

function Table({ label, head, rows }: { label: string; head: string; rows: { name: string; micro_usd: number; calls?: number }[] }) {
  if (!rows.length) return <p className="v2-panel-body scr-muted">Nothing recorded yet.</p>;
  return (
    <TableWrap label={label}>
      <table className="v2-table scr-table-compact">
        <thead>
          <tr>
            <th>{head}</th>
            <th>Cost</th>
            {rows.some((row) => row.calls !== undefined) ? <th>Calls</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td className="scr-num">{usd(row.micro_usd)}</td>
              {row.calls !== undefined ? <td className="scr-num">{row.calls}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export default async function CostsPage() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("provider_spend_report", { p_days: 7 });
  if (error || !data) notFound();
  const report = data as Report;
  return (
    <Screen label="Costs">
      <PageHeader
        eyebrow="Owner"
        title={`${usd(report.total_micro_usd)} in the last 7 days.`}
        sub={`${usd(report.micro_usd_per_approved)} per approved card (${report.approved_cards} approved).${report.unpriced_calls ? ` ${report.unpriced_calls} calls have no price yet.` : ""}`}
      />
      <Panel id="costs-providers" title="By provider">
        <Table label="By provider" head="Provider" rows={report.by_provider.map((row) => ({ name: row.provider ?? "?", micro_usd: row.micro_usd, calls: row.calls }))} />
      </Panel>
      <Panel id="costs-kinds" title="By kind of work">
        <Table label="By kind of work" head="Work" rows={report.by_kind.map((row) => ({ name: row.kind ?? "?", micro_usd: row.micro_usd, calls: row.calls }))} />
      </Panel>
      <Panel id="costs-founders" title="Top founders">
        <Table label="Top founders" head="Founder" rows={report.top_founders.map((row) => ({ name: row.email ?? "?", micro_usd: row.micro_usd }))} />
      </Panel>
    </Screen>
  );
}
