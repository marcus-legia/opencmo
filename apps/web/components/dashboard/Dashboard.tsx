"use client";

/**
 * The v2 home, the feed (Today redesign, canvas Main.dc.html): the headline, the week's loop in one line, then the
 * approval queue first, one row per thing to do, opened in place. Beside it: the goal, the team and the live log.
 * Data: `DashboardScreen` from `/api/v1/screens/dashboard`; a block whose `live` flag is false shows "Sample data".
 */

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { Icon } from "@/components/icons";
import { useShellState } from "@/components/shell-v2/ShellState";
import { isTodayPrompt } from "@/lib/cmo/today";
import { Button, Panel } from "@/components/ui";

import { ApprovalQueue } from "./ApprovalQueue";
import { DashboardHeader } from "./Header";
import { LiveLog } from "./LiveLog";
import { ResultsPanel, TodayPanel } from "./Tables";
import { TeamGrid } from "./TeamGraph";
import { fillChat, TodayBlock } from "./TodayBlock";
import { useDashboard } from "./useDashboard";

export function Dashboard() {
  const { state, decideCard, waiting, setPausedAt, reload } = useDashboard();
  const { focusChat, workVersion } = useShellState();
  // `?ask=1` (the Brain and Writer pages link to it) lands in the shell's chat. The History API drops the flag, not the
  // router: a router change would render this dynamic page again on the server.
  const search = useSearchParams();
  const asking = search.get("ask") === "1";
  // `prompt` (the email's Today rows): the request goes into the chat's box and the founder sends it. Only a request
  // Today itself writes is taken, so a link cannot type someone else's instructions into the chat.
  const asked = search.get("prompt") ?? "";
  const prompt = isTodayPrompt(asked) ? asked : "";
  useEffect(() => {
    if (!asking) return;
    focusChat();
    if (prompt) fillChat(prompt);
    const url = new URL(window.location.href);
    url.searchParams.delete("ask");
    url.searchParams.delete("prompt");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [asking, prompt, focusChat]);
  // Work the chat starts (a task, a draft) shows up in the queue and the graph.
  useEffect(() => {
    if (workVersion > 0) void reload();
  }, [workVersion, reload]);

  if (state.status === "loading") {
    return (
      <div className="v2-dash" aria-busy="true">
        <p className="v2-muted">Loading your team…</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="v2-dash">
        <div className="v2-empty" role="alert">
          <b className="v2-empty-title">The Dashboard did not load.</b>
          <span className="v2-empty-text">{state.message}</span>
          <div className="v2-actions">
            <Button variant="secondary" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { data, live } = state;
  const count = data.queue.filter((card) => card.status === "waiting").length;
  const { week } = data;
  const credits = week.credits.budget > 0 ? `${week.credits.used} / ${week.credits.budget}` : `${week.credits.used}`;

  const outCount = data.outToday.filter((row) => row.status !== "failed").length;
  const goalPct = week.deliverables.total > 0 ? Math.round((week.deliverables.done / week.deliverables.total) * 100) : 0;

  return (
    <div className="v2-dash td-feed" data-testid="v2-dashboard">
      <DashboardHeader count={count} goal={week.deliverables} pausedAt={data.cmo.pausedAt} pauseLive={live.cmo} onPaused={setPausedAt} onAsk={focusChat} />

      {/* The week's loop in one line (canvas "flow"): what waits, what goes out, what is done. Numbers only from the screen. */}
      <nav className="td-flow" aria-label="This week">
        <a href="#approval-queue" className="td-flow-step">
          <b className="v2-num">{count}</b> waiting on you
        </a>
        <Icon name="chevron-right" size={14} className="td-flow-arrow" />
        <Link href="/app/schedule" className="td-flow-step">
          <b className="v2-num">{outCount}</b> going out today
        </Link>
        <Icon name="chevron-right" size={14} className="td-flow-arrow" />
        <Link href="/app/writer" className="td-flow-step">
          <b className="v2-num">
            {week.deliverables.done}/{week.deliverables.total}
          </b>{" "}
          done this week
        </Link>
        <span className="td-spacer" />
        <span className="v2-mono is-muted">Credits this week {credits}</span>
      </nav>

      <div className="v2-dash-cols">
        <div className="v2-dash-main">
          <TodayBlock today={data.today} cards={data.queue} live={live.today} onDecide={decideCard} onAsk={focusChat} />
          <div id="approval-queue">
            <ApprovalQueue cards={data.queue} live={live.queue} digest={data.digest} onDecide={decideCard} />
          </div>
          <div className="v2-dash-today">
            <TodayPanel rows={data.outToday} live={live.outToday} waiting={(id) => data.queue.some((card) => card.id === id)} />
          </div>
          <div className="v2-dash-results">
            <ResultsPanel results={data.results} live={live.results} />
          </div>
        </div>
        <div className="v2-dash-side td-side">
          <Panel id="week-title" title="Goal this week" className="v2-dash-week">
            <div className="v2-panel-body">
              <div className="td-goal">{week.goal ?? "No goal yet. Ask your CMO to set one."}</div>
              <div className="v2-progress" aria-hidden="true">
                <span style={{ width: `${goalPct}%` }} />
              </div>
              <div className="v2-mono is-muted td-goal-note">
                {week.deliverables.done} of {week.deliverables.total} done · {week.workingNow} of {data.team.nodes.length} working now ·{" "}
                {week.wordsDraftedToday.toLocaleString("en-US")} words today
              </div>
            </div>
          </Panel>
          <Panel id="team-title" title="Your team" mark live sample={!live.team || !live.log} className="v2-dash-team">
            <TeamGrid team={data.team} waiting={waiting} />
            <LiveLog events={data.log} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
