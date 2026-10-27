import Link from "next/link";

import { NUMERAL, DEPARTMENT_LABEL } from "@/components/cards/model";
import type { DepartmentName } from "@/components/shell-v2/nav";

import type { DashboardView, NodeState, TeamNode } from "./model";
import { Robot } from "./Robot";

/** Node boxes and wires at the positions of Main.dc.html (a 760 × 690 board). */
const NODE: Record<DepartmentName, { left: number; top: number; href: string; delay: number }> = {
  research: { left: 24, top: 196, href: "/app/research", delay: 0 },
  writer: { left: 208, top: 196, href: "/app/writer", delay: 0.4 },
  studio: { left: 392, top: 196, href: "/app/studio", delay: 0.8 },
  sales: { left: 576, top: 196, href: "/app/sales", delay: 0.6 },
  schedule: { left: 300, top: 448, href: "/app/schedule", delay: 0.2 },
  publish: { left: 576, top: 448, href: "/app/schedule", delay: 1.2 },
};

/** Where each top-row department drops from the bus. */
const DROP_X: Partial<Record<DepartmentName, number>> = { research: 104, writer: 288, studio: 472, sales: 656 };

type Wire = { x: number; y: number; w: number; h: number; d: string; dashed?: boolean; arrow?: boolean };

const vertical = (x: number, y: number, h: number, extra: Partial<Wire> = {}): Wire => ({ x: x - 4, y, w: 8, h, d: `M 4 0 L 4 ${h}`, ...extra });
const horizontal = (x: number, y: number, w: number, reverse = false, extra: Partial<Wire> = {}): Wire => ({
  x,
  y: y - 4,
  w,
  h: 8,
  d: reverse ? `M ${w} 4 L 0 4` : `M 0 4 L ${w} 4`,
  ...extra,
});

const BASE: Wire[] = [
  vertical(380, 128, 36),
  horizontal(104, 164, 552),
  ...Object.values(DROP_X).map((x) => vertical(x!, 164, 32)),
  vertical(288, 364, 40),
  vertical(472, 364, 40),
  horizontal(288, 404, 184),
  { ...vertical(380, 404, 43), d: "M 4 0 L 4 39", arrow: true },
  { ...horizontal(460, 532, 115), d: "M 0 4 L 111 4", arrow: true },
  vertical(656, 616, 24, { dashed: true }),
  horizontal(104, 640, 552, false, { dashed: true }),
  { ...vertical(104, 365, 275, { dashed: true }), d: "M 4 275 L 4 4", arrow: true },
];

/** Packets run along the wires that carry work right now: from the Brain to each working department, then on to Schedule. */
function activeWires(working: Set<DepartmentName>): Wire[] {
  const wires: Wire[] = [];
  if (working.size > 0) wires.push(vertical(380, 128, 36));
  for (const [department, x] of Object.entries(DROP_X) as [DepartmentName, number][]) {
    if (!working.has(department)) continue;
    wires.push(x < 380 ? horizontal(x, 164, 380 - x, true) : horizontal(380, 164, x - 380));
    wires.push(vertical(x, 164, 32));
  }
  for (const department of ["writer", "studio"] as const) {
    if (!working.has(department) || !working.has("schedule")) continue;
    const x = DROP_X[department]!;
    wires.push(vertical(x, 364, 40));
    wires.push(x < 380 ? horizontal(x, 404, 380 - x) : horizontal(380, 404, x - 380, true));
  }
  if (working.has("schedule")) wires.push(vertical(380, 404, 39));
  return wires;
}

function WireSvg({ wire, active, id }: { wire: Wire; active?: boolean; id: string }) {
  return (
    <svg
      width={wire.w}
      height={wire.h}
      viewBox={`0 0 ${wire.w} ${wire.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={active ? "v2-wire is-active" : wire.dashed ? "v2-wire is-dashed" : "v2-wire"}
      style={{ left: wire.x, top: wire.y, width: wire.w, height: wire.h }}
    >
      {wire.arrow ? (
        <defs>
          <marker id={id} orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible">
            <path d="M0 0 L4 2 L0 4 Z" fill="var(--v2-line2)" />
          </marker>
        </defs>
      ) : null}
      <path d={wire.d} markerEnd={wire.arrow ? `url(#${id})` : undefined} />
    </svg>
  );
}

export type WaitingChip = { label: string; tone: "waiting" | "idle" };

/** "2 waiting on you" when cards wait; otherwise what the department is doing. */
export function waitingChip(node: TeamNode, waiting: number, short = false): WaitingChip {
  if (waiting > 0) return { label: short ? `${waiting} waiting` : `${waiting} waiting on you`, tone: "waiting" };
  return { label: node.state === "idle" ? "Idle" : "Nothing waiting", tone: "idle" };
}

const STATE_WORD: Record<NodeState, string> = { working: "working", idle: "idle", stuck: "stuck" };

export function TeamGraph({ view, waiting }: { view: DashboardView; waiting: (department: DepartmentName) => number }) {
  const working = new Set(view.team.filter((node) => node.state === "working").map((node) => node.department));
  return (
    <div className="v2-graph-scroll">
      <div className="v2-graph">
        {BASE.map((wire, index) => (
          <WireSvg key={`b${index}`} wire={wire} id={`v2-arrow-${index}`} />
        ))}
        {activeWires(working).map((wire, index) => (
          <WireSvg key={`a${index}`} wire={wire} active id={`v2-packet-${index}`} />
        ))}

        <div className="v2-node-slot" style={{ left: 250, top: 24 }}>
          <Link href="/app/brain" className="v2-hub">
            <Robot state="hub" />
            <span>
              <span className="v2-hub-label">Brain · {view.brain.status}</span>
              <br />
              <b className="v2-hub-line">{view.brain.line}</b>
              {view.brain.nextCheck ? (
                <>
                  <br />
                  <span className="v2-hub-next">Next check {view.brain.nextCheck}</span>
                </>
              ) : null}
            </span>
          </Link>
        </div>

        {view.team.map((node) => {
          const place = NODE[node.department];
          const chip = waitingChip(node, waiting(node.department));
          return (
            <div key={node.department} className="v2-node-slot" style={{ left: place.left, top: place.top }}>
              <Link href={place.href} className={`v2-node is-${node.state}`} aria-label={`${DEPARTMENT_LABEL[node.department]}, ${STATE_WORD[node.state]}: ${node.status}. ${chip.label}.`}>
                <Robot state={node.state} delay={place.delay} />
                <span>
                  <b className="v2-node-name">{DEPARTMENT_LABEL[node.department]}</b> <span className="v2-numeral">{NUMERAL[node.department]}</span>
                  <br />
                  <span className="v2-node-status">{node.status}</span>
                  <br />
                  <span className={`v2-chip is-${chip.tone}`}>{chip.label}</span>
                </span>
              </Link>
            </div>
          );
        })}

        <div className="v2-graph-note" style={{ left: 290, top: 652 }}>
          results feed Sunday&apos;s review
        </div>
      </div>
    </div>
  );
}

/** The phone version (DashboardPhone.dc.html): one row per department, the all-clear ones folded into one line. */
export function TeamList({ view, waiting }: { view: DashboardView; waiting: (department: DepartmentName) => number }) {
  const busy = view.team.filter((node) => node.state === "stuck" || waiting(node.department) > 0);
  const clear = view.team.filter((node) => !busy.includes(node));
  return (
    <section aria-label="Your team" className="v2-teamlist">
      <Link href="/app/brain" className="v2-teamlist-brain">
        <span className="v2-mark" aria-hidden="true" />
        <span className="v2-teamlist-name">Brain</span>
        <span className="v2-teamlist-note">{view.brain.status}</span>
      </Link>
      {busy.map((node) => {
        const chip = waitingChip(node, waiting(node.department), true);
        return (
          <Link key={node.department} href={NODE[node.department].href} className="v2-teamlist-row">
            <span className="v2-numeral v2-teamlist-numeral">{NUMERAL[node.department]}</span>
            <span className="v2-teamlist-name">{DEPARTMENT_LABEL[node.department]}</span>
            {node.state === "stuck" ? <span className="v2-chip is-stuck">stuck</span> : <span className={`v2-chip is-${chip.tone}`}>{chip.label}</span>}
          </Link>
        );
      })}
      {clear.length > 0 ? (
        <Link href="/app/brain" className="v2-teamlist-clear">
          {clear.map((node) => DEPARTMENT_LABEL[node.department]).join(", ")}: all clear
        </Link>
      ) : null}
    </section>
  );
}
