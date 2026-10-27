"use client";

/**
 * The v2 home (S2): week strip, team graph with the live log, results, what goes out today, and the approval queue.
 * Desktop follows Main.dc.html; at phone width the graph becomes a list and the queue moves up (DashboardPhone.dc.html).
 */

import { Button, Kpi, KpiStrip, Panel } from "@/components/ui";

import { ApprovalQueue } from "./ApprovalQueue";
import { DashboardHeader } from "./Header";
import { LiveLog } from "./LiveLog";
import { ResultsPanel, TodayPanel } from "./Tables";
import { TeamGraph, TeamList } from "./TeamGraph";
import { useDashboard } from "./useDashboard";

export function Dashboard() {
  const { state, view, decideCard, waiting, reload } = useDashboard();

  if (state.status === "loading") {
    return (
      <div className="v2-dash" aria-busy="true">
        <p className="v2-muted">Loading your team…</p>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="v2-dash">
        <div className="v2-empty" role="alert">
          <b className="v2-empty-title">The Dashboard did not load.</b>
          <span className="v2-empty-text">{state.status === "error" ? state.message : null}</span>
          <div className="v2-actions">
            <Button variant="secondary" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const count = view.queue.filter((card) => card.state === "waiting").length;
  const working = view.team.filter((node) => node.state === "working").length;
  const { week } = view;

  return (
    <div className="v2-dash" data-testid="v2-dashboard">
      <DashboardHeader count={count} timezone={view.timezone} goal={week} pauseLive={view.live.pause} paused={view.paused} />

      <div className="v2-dash-week">
        <KpiStrip label="This week, live">
          <Kpi label="Week goal" value={week.goal ?? "No goal yet"} text progress={week.total > 0 ? (week.done / week.total) * 100 : 0} />
          <Kpi label="Deliverables done" value={`${week.done} / ${week.total}`} />
          <Kpi label="Working now" value={`${working} of ${view.team.length}`} />
          <Kpi label="Words drafted today" value={week.wordsToday === null ? null : week.wordsToday.toLocaleString("en-US")} />
          <Kpi label="Credits this week" value={week.credits.budget === null ? `${week.credits.used}` : `${week.credits.used} / ${week.credits.budget}`} />
        </KpiStrip>
      </div>

      <div className="v2-dash-cols">
        <div className="v2-dash-main">
          <Panel id="team-title" title="Your team, working" mark live sample={!view.live.team} className="v2-dash-team" actions={<Legend />}>
            <TeamGraph view={view} waiting={waiting} />
            <LiveLog events={view.log} timezone={view.timezone} />
          </Panel>
          <div className="v2-dash-teamlist">
            <TeamList view={view} waiting={waiting} />
          </div>
          <div className="v2-dash-results">
            <ResultsPanel results={view.results} live={view.live.results} />
          </div>
          <div className="v2-dash-today">
            <TodayPanel rows={view.today} live={view.live.today} waiting={(id) => view.queue.some((card) => card.id === id)} />
          </div>
        </div>
        <div className="v2-dash-side">
          <ApprovalQueue cards={view.queue} live={view.live.queue} nextCard={view.nextCard} onDecide={decideCard} />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="v2-legend" aria-label="Legend">
      <span>
        <span className="v2-legend-key is-working" aria-hidden="true" />
        Working
      </span>
      <span>
        <span className="v2-legend-key is-idle" aria-hidden="true" />
        Idle
      </span>
      <span>
        <span className="v2-legend-key is-stuck" aria-hidden="true" />
        Stuck
      </span>
    </div>
  );
}
