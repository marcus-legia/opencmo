/** Seven CSS bars, newest last. Values are relative; the tallest bar is full height. */
export function Sparkline({ values, tone = "ink", label }: { values: number[]; tone?: "ink" | "brand" | "flat"; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <span role="img" aria-label={label} className={tone === "ink" ? "v2-spark" : `v2-spark is-${tone}`}>
      {values.map((value, index) => (
        <span key={index} style={{ height: `${Math.max(4, Math.round((value / max) * 100))}%` }} />
      ))}
    </span>
  );
}
