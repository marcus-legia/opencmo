"use client";

import { useEffect, useState } from "react";

import { PauseButton } from "@/components/screens/brain/PauseButton";
import { Logo } from "@/components/shell-v2/Logo";
import { Button } from "@/components/ui";

/** "5 things wait on you." from the queue count: the same number as the rail badge. */
export function headline(count: number): string {
  if (count === 0) return "Nothing waits on you.";
  return count === 1 ? "1 thing waits on you." : `${count} things wait on you.`;
}


/** The viewer's own clock: the Dashboard has no time zone field, and the browser's is the one the founder reads. */
function useClock() {
  // Empty on the server and the first client frame: the time is the viewer's, not the build machine's.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) return { clock: "--:--:--", day: "", short: "" };
  const zone = {};
  return {
    clock: new Intl.DateTimeFormat("en-GB", { ...zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now),
    day: new Intl.DateTimeFormat("en-GB", { ...zone, weekday: "long", day: "numeric", month: "short" }).format(now).replace(",", ""),
    short: new Intl.DateTimeFormat("en-GB", { ...zone, weekday: "short", day: "numeric", month: "short" }).format(now).replace(",", ""),
  };
}

export function DashboardHeader({
  count,
  goal,
  pausedAt,
  pauseLive,
  onPaused,
  onAsk,
}: {
  count: number;
  goal: { done: number; total: number };
  pausedAt: string | null;
  pauseLive: boolean;
  onPaused: (pausedAt: string | null) => void;
  onAsk: () => void;
}) {
  const { clock, day, short } = useClock();
  const pct = goal.total > 0 ? Math.round((goal.done / goal.total) * 100) : 0;

  return (
      <header className="v2-dash-head">
        <div className="v2-dash-phonebar">
          <span className="v2-dash-phonebrand">
            <Logo size={24} />
            <span>OpenCMO</span>
          </span>
          <span className="v2-actions">
            <Button variant="secondary" icon aria-label="Ask your CMO" onClick={onAsk}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 5h16v11H9l-5 4z" />
              </svg>
            </Button>
          </span>
        </div>

        <div className="v2-dash-title">
          <span className="v2-mono is-muted v2-dash-eyebrow">
            <span className="v2-mark is-live" aria-hidden="true" />
            <span className="v2-dash-wide">
              Live · <span className="v2-num" data-testid="dash-clock">{clock}</span>
              {day ? ` · ${day}` : null}
            </span>
            <span className="v2-dash-narrow">
              {short ? `${short} · ` : null}goal {goal.done} of {goal.total}
            </span>
          </span>
          <h1 className="v2-dash-headline" data-testid="dash-headline">
            {headline(count)}
          </h1>
          <span className="v2-dash-narrow v2-dash-progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        </div>

        <div className="v2-actions v2-dash-buttons">
          <span className="v2-dash-wide">
            <Button variant="secondary" onClick={onAsk}>
              Ask your CMO
            </Button>
          </span>
          {/* One Pause control for every width (it holds its own confirm dialog); on a phone CSS lifts it into the top bar. */}
          <PauseButton pausedAt={pausedAt} live={pauseLive} onChange={onPaused} />
        </div>
      </header>
  );
}
