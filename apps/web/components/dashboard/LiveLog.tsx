import { DEPARTMENT_LABEL } from "@/components/cards/model";

import type { LogEvent } from "./model";

const WHO_LABEL = (who: LogEvent["who"]) => (who === "you" ? "You" : who === "brain" ? "Brain" : DEPARTMENT_LABEL[who]);

/** Newest five events. The list is a polite live region: a new line is read out without stealing focus. */
export function LiveLog({ events, timezone }: { events: LogEvent[]; timezone: string }) {
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: timezone });
  const newest = [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  return (
    <div className="v2-log">
      <span className="v2-mono is-small is-muted">Live log</span>
      <ol aria-live="polite" aria-relevant="additions" className="v2-log-list" data-testid="live-log">
        {newest.map((event, index) => (
          <li key={event.id} style={{ opacity: 1 - index * 0.14 }}>
            <time dateTime={event.at} className="v2-log-time">
              {time.format(new Date(event.at))}
            </time>
            <span className={`v2-log-who is-${event.who}`}>{WHO_LABEL(event.who)}</span>
            <span>{event.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
