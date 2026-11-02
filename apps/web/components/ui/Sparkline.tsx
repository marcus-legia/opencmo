/**
 * CSS bars, oldest first. Values are relative; the tallest bar is full height. A null is a day with no data: it
 * draws as a gap, never as zero.
 */
export function Sparkline({ values, tone = "ink", label }: { values: (number | null)[]; tone?: "ink" | "brand" | "flat"; label: string }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <span role="img" aria-label={label} className={tone === "ink" ? "v2-spark" : `v2-spark is-${tone}`}>
      {values.map((value, index) => (
        <span key={index} className={value === null ? "is-missing" : undefined} style={{ height: value === null ? "100%" : `${Math.max(4, Math.round((value / max) * 100))}%` }} />
      ))}
    </span>
  );
}
