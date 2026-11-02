"use client";

/** A small set of mutually exclusive options (range, view): toggle buttons in one pill. */
export function Segmented<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="v2-segmented">
      {items.map((item) => (
        <button key={item.id} type="button" className="v2-segment" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
