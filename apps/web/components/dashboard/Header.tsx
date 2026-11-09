"use client";

import { useEffect, useState } from "react";

import { PauseButton } from "@/components/screens/brain/PauseButton";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui";

import { Robot } from "./Robot";

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
    <header className="v2-dash-head td-hello">
      <span className="td-hello-robot" aria-hidden="true">
        <Robot state="hub" />
      </span>
      <div className="v2-dash-title">
        <h1 className="v2-dash-headline" data-testid="dash-headline">
          {headline(count)}
          <span className="v2-mark is-live" aria-hidden="true" />
        </h1>
        <p className="v2-mono is-muted v2-dash-eyebrow">
          <span className="v2-dash-wide">
            <span className="v2-num" data-testid="dash-clock">{clock}</span>
            {day ? ` · ${day}` : null}
            {` · goal ${goal.done} of ${goal.total}`}
          </span>
          <span className="v2-dash-narrow">
            {short ? `${short} · ` : null}goal {goal.done} of {goal.total} · {pct}%
          </span>
        </p>
      </div>

      <div className="v2-actions v2-dash-buttons">
        <Button variant="secondary" onClick={onAsk}>
          <Icon name="message-circle" size={14} />
          Ask your CMO
        </Button>
        {/* One Pause control for every width (it holds its own confirm dialog). */}
        <PauseButton pausedAt={pausedAt} live={pauseLive} onChange={onPaused} />
      </div>
    </header>
  );
}
