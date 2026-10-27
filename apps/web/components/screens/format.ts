/** Number formats shared by the v2 pages. `null` always prints as a dash: not reported, never zero. */

export const DASH = "—";

export function int(n: number | null | undefined): string {
  return n == null ? DASH : Math.round(n).toLocaleString("en-US");
}

/** 114.4k above ten thousand, plain digits below (the frame's rule). */
export function compact(n: number | null | undefined): string {
  if (n == null) return DASH;
  return Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}k` : int(n);
}

export function pct(ratio: number | null | undefined, digits = 1): string {
  return ratio == null ? DASH : `${(ratio * 100).toFixed(digits)}%`;
}

export function signed(n: number | null | undefined, format: (n: number) => string = int): string {
  if (n == null) return DASH;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${format(Math.abs(n))}`;
}

export function times(n: number | null | undefined): string {
  return n == null ? DASH : `${n.toFixed(1)}×`;
}
