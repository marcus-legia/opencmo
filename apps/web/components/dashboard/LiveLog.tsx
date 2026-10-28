import { DEPARTMENT_LABEL } from "@/lib/screens/common";
import type { LogLine } from "@/lib/screens/common";

const whoLabel = (who: LogLine["who"]) => (who === "you" ? "You" : DEPARTMENT_LABEL[who]);

/** Newest five events. The list is a polite live region: a new line is read out without stealing focus. */
export function LiveLog({ events }: { events: LogLine[] }) {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const newest = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  return (
    <div className="v2-log">
      <span className="v2-mono is-small is-muted">Live log</span>
      {newest.length === 0 ? (
        <p className="v2-muted">Nothing has run yet this week. Lines show up here as your team works.</p>
      ) : (
        <ol aria-live="polite" aria-relevant="additions" className="v2-log-list" data-testid="live-log">
          {/* No fade on older lines (the frame has one): faded label text drops under 4.5:1. */}
          {newest.map((event) => (
            <li key={event.id}>
              <time dateTime={event.at} className="v2-log-time">
                {time.format(new Date(event.at))}
              </time>
              <span className={`v2-log-who is-${event.who}`}>{whoLabel(event.who)}</span>
              <span>{event.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
