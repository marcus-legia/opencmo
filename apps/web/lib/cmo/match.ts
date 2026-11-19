/**
 * One place for what the Sales screen and the morning email must agree on (review of #238): the Strong / Good match
 * line, and the time zone used to write a founder's times. Free of server code, so client screens import it too.
 */

/** A thread at or above this score is a Strong match; below it, a Good match (cards start at 60). */
export const STRONG_MATCH = 75;

export const matchLabel = (score: number): "Strong match" | "Good match" => (score >= STRONG_MATCH ? "Strong match" : "Good match");

/** The founder's zone when the runtime knows it, else UTC: an unknown name must never throw while writing a time. */
export function zoneOrUtc(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}
