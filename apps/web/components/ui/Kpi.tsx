import type { ReactNode } from "react";

/** One tile of a KPI strip; put several inside `<KpiStrip>`. A null value renders a dash: "not reported", never zero. */
export function Kpi({
  label,
  value,
  text,
  delta,
  progress,
}: {
  label: string;
  value: ReactNode | null;
  /** Value is words (a goal), not a number. */
  text?: boolean;
  delta?: { label: string; direction: "up" | "down" | "flat" };
  /** 0–100. */
  progress?: number;
}) {
  return (
    <div className="v2-kpi">
      <span className="v2-mono is-small is-muted">{label}</span>
      <span className={text ? "v2-kpi-value is-text" : "v2-kpi-value"}>{value ?? "–"}</span>
      {delta ? <span className={`v2-kpi-delta is-${delta.direction}`}>{delta.label}</span> : null}
      {progress !== undefined ? (
        <span className="v2-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </span>
      ) : null}
    </div>
  );
}

export function KpiStrip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="v2-kpis">
      {children}
    </section>
  );
}
