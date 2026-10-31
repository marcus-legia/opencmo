/**
 * Times in the founder's timezone (`profiles.timezone`), never the browser's or the server's: what Schedule shows,
 * what its pickers read and where its weeks start. Pure, so cards, screens and loaders share it.
 */

/** Wall-clock parts of `t` in `timezone`. */
function wall(t: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** `YYYY-MM-DDTHH:MM` as a `datetime-local` input wants it, in `timezone`. */
export function toLocalInput(iso: string, timezone: string): string {
  const { date, time } = wall(new Date(iso).getTime(), timezone);
  return `${date}T${time}`;
}

const offsetAt = (t: number, timezone: string) => {
  const { date, time } = wall(t, timezone);
  return Date.parse(`${date}T${time}:00Z`) - Math.floor(t / 60_000) * 60_000;
};

/**
 * A `datetime-local` value read in `timezone` → UTC `YYYY-MM-DDTHH:MM:SSZ`. The offset is taken twice so a time next
 * to a DST change lands on the offset that applies at the result, not at the guess.
 */
export function fromLocalInput(value: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const guess = Date.parse(`${value}:00Z`);
  if (Number.isNaN(guess)) return null;
  const first = guess - offsetAt(guess, timezone);
  const t = guess - offsetAt(first, timezone);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "Thu 29 Oct, 18:00" in the founder's zone. */
export function formatWhen(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/** The Monday (`YYYY-MM-DD`) of the week `t` falls in, as the founder's calendar reads it. */
export function localMonday(t: number, timezone: string): string {
  const day = wall(t, timezone).date;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Midnight at the start of local day `day` (`YYYY-MM-DD`) in `timezone`, in UTC. */
export function localMidnight(day: string, timezone: string): string | null {
  return fromLocalInput(`${day}T00:00`, timezone);
}
