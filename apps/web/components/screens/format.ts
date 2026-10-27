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

/** "2 min ago", "1 h ago", "3 d ago". A time in the future (clock skew, sample data) reads "just now". */
export function ago(isoTime: string | null | undefined, now = Date.now()): string {
  if (!isoTime) return DASH;
  const minutes = Math.floor((now - new Date(isoTime).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "27 Oct" in the viewer's time zone. */
export function shortDate(isoTime: string | null | undefined): string {
  if (!isoTime) return DASH;
  return new Date(isoTime).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Rates in the contracts are percent numbers (3.9 = 3.9%). */
export function percent(n: number | null | undefined, digits = 1): string {
  return n == null ? DASH : `${n.toFixed(digits)}%`;
}
