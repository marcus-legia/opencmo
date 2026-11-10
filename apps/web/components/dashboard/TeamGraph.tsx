import Link from "next/link";

import { DEPARTMENT_LABEL, type Department } from "@/lib/screens/common";
import type { DashboardScreen } from "@/lib/screens/dashboard";

import { Robot, type NodeState } from "./Robot";

type DepartmentName = Exclude<Department, "brain">;
type Team = DashboardScreen["team"];
type TeamNode = Team["nodes"][number];

const BRAIN_STATE: Record<Team["brain"]["state"], string> = { on_track: "on track", stuck: "stuck", paused: "paused" };


/** Where each department links, and the stagger of its robot's animation. */
const NODE: Record<DepartmentName, { href: string; delay: number }> = {
  research: { href: "/app/research", delay: 0 },
  writer: { href: "/app/writer", delay: 0.4 },
  studio: { href: "/app/studio", delay: 0.8 },
  sales: { href: "/app/sales", delay: 0.6 },
  schedule: { href: "/app/schedule", delay: 0.2 },
  publish: { href: "/app/schedule", delay: 1.2 },
};

export type WaitingChip = { label: string; tone: "waiting" | "idle" };

/** "2 waiting on you" when cards wait; otherwise what the department is doing. */
export function waitingChip(node: TeamNode, waiting: number, short = false): WaitingChip {
  if (waiting > 0) return { label: short ? `${waiting} waiting` : `${waiting} waiting on you`, tone: "waiting" };
  return { label: node.state === "idle" ? "Idle" : "Nothing waiting", tone: "idle" };
}

const STATE_WORD: Record<NodeState, string> = { working: "working", idle: "idle", stuck: "stuck" };

/**
 * The team as a compact list of agents (Today redesign, canvas Main.dc.html): one row per department with what it is
 * doing, the Brain first. Same region name as the phone list, on every width.
 */
export function TeamGrid({ team, waiting }: { team: Team; waiting: (department: DepartmentName) => number }) {
  return (
    // Inside the "Your team" panel, which already names the region: a second label made two landmarks of one name.
    <section className="td-team">
      <Link href="/app/brain" className="td-agent is-brain">
        <Robot state="hub" />
        <span className="td-agent-text">
          <span className="td-agent-name">Brain</span>
          <span className="td-agent-line">
            {BRAIN_STATE[team.brain.state]} · {team.brain.watching === 1 ? "watching 1 order" : `watching ${team.brain.watching} orders`}
          </span>
        </span>
      </Link>
      {team.nodes.map((node) => {
        const chip = waitingChip(node, waiting(node.department), true);
        return (
          <Link
            key={node.department}
            href={NODE[node.department].href}
            className="td-agent"
            data-state={node.state}
            aria-label={`${DEPARTMENT_LABEL[node.department]}, ${STATE_WORD[node.state]}: ${node.line}`}
          >
            <Robot state={node.state} delay={NODE[node.department].delay} />
            <span className="td-agent-text">
              <span className="td-agent-name">{DEPARTMENT_LABEL[node.department]}</span>
              <span className="td-agent-line">{node.line}</span>
            </span>
            {node.state === "stuck" ? <span className="v2-chip is-stuck">stuck</span> : chip.tone === "waiting" ? <span className="v2-chip is-waiting">{chip.label}</span> : null}
          </Link>
        );
      })}
    </section>
  );
}
