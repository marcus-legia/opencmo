"use client";

import { Fragment, useState } from "react";

import type { BrainScreen as Data, Learned, OrderRow } from "@/lib/screens/brain";
import { DEPARTMENT_LABEL } from "@/lib/screens/common";

import { shortDate } from "../format";
import { Button, Chip, ErrorNote, LinkButton, PageHeader, Panel, Screen, SkeletonBlocks, Tabs, type ChipTone } from "../kit";
import { useTabParam } from "../useTabParam";
import { isSample, useScreen } from "../useScreen";
import { PauseButton } from "./PauseButton";

const TABS = [
  { id: "week", label: "This week" },
  { id: "memory", label: "Memory" },
  { id: "past", label: "Past weeks" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const KIND_LABEL: Record<Learned["kind"], string> = {
  lesson: "Lesson",
  rule: "Rule",
  skip_reason: "Skip reason",
  goal_result: "Goal",
  memory: "Memory",
};

const STATE_TONE: Record<OrderRow["state"], ChipTone> = {
  queued: "idle",
  running: "running",
  waiting_founder: "waiting",
  waiting_order: "idle",
  deferred: "idle",
  done: "posted",
  failed: "stuck",
  cancelled: "idle",
};

export function BrainScreen() {
  const [tab, setTab] = useTabParam<Tab>("tab", TABS.map((t) => t.id), "week");
  const [state] = useScreen("brain");

  return (
    <Screen label="Brain">
      <PageHeader
        eyebrow="Brain · thinks with OpenCMO's model"
        title="The plan, the orders, what it learned."
        sample={state.status === "ready" && isSample(state.live)}
        actions={
          <>
            <LinkButton href="/app?ask=1">Ask your CMO</LinkButton>
            <PauseButton />
          </>
        }
      />
      <Tabs label="Brain views" tabs={[...TABS]} value={tab} onChange={setTab} />
      {state.status === "loading" && <SkeletonBlocks />}
      {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
      {state.status === "ready" && <BrainBody data={state.data} tab={tab} />}
    </Screen>
  );
}

function BrainBody({ data, tab }: { data: Data; tab: Tab }) {
  // Deleting a note waits for the corrections RPC (brain B0); until then it only hides the row.
  const [learned, setLearned] = useState(data.learned);
  const forget = (id: string) => setLearned((all) => all.filter((note) => note.id !== id));
  const { week } = data;
  const checkAt = week.nextCheckAt
    ? new Date(week.nextCheckAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (tab === "week") {
    return (
      <div className="scr-split">
        <Panel
          className="scr-main"
          title={week.goal ? `Orders · goal: ${week.goal}` : "Orders"}
          aside={
            <span className="scr-small scr-muted">
              {week.done} of {week.total} done · {week.credits.used} of {week.credits.budget} credits
            </span>
          }
          foot={`${checkAt ? `The daily check runs at ${checkAt}. ` : ""}Only a stuck order costs a replan.`}
        >
          {data.orders.length ? (
            <OrdersTable orders={data.orders} />
          ) : (
            <p className="scr-panel-body scr-muted">No orders yet. The Brain plans the week on Monday, or when you set a goal.</p>
          )}
        </Panel>
        <Panel as="aside" className="scr-side" title="Learned lately" sub="Each note shows where it came from. Delete any.">
          <MemoryList notes={learned.slice(0, 4)} onForget={forget} />
        </Panel>
      </div>
    );
  }

  if (tab === "memory") {
    return (
      <Panel
        title="Memory"
        sub="Lessons from results, rules from your edits, reasons you skipped things. Newer notes win; delete any you don't agree with."
      >
        {learned.length ? (
          <MemoryList notes={learned} onForget={forget} />
        ) : (
          <p className="scr-panel-body scr-muted">Nothing learned yet. Notes appear after your first week of approvals.</p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Past weeks" sub="Each Sunday the Brain closes the week against its goal.">
      {data.pastWeeks.length ? (
        <div className="scr-table-wrap">
          <table className="scr-table">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Goal</th>
                <th>Orders done</th>
                <th>Credits</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.pastWeeks.map((w) => (
                <tr key={w.week}>
                  <td className="scr-num">{shortDate(`${w.week}T12:00:00Z`)}</td>
                  <td>
                    <b className="scr-strong">{w.goal ?? "No goal set"}</b>
                  </td>
                  <td className="scr-num">
                    {w.done} / {w.total}
                  </td>
                  <td className="scr-num">
                    {w.credits.used} / {w.credits.budget}
                  </td>
                  <td>{w.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="scr-panel-body scr-muted">Your first week closes on Sunday.</p>
      )}
    </Panel>
  );
}

function due(order: OrderRow): string {
  if (order.dueText) return order.dueText;
  if (!order.dueAt) return "—";
  return new Date(order.dueAt).toLocaleDateString("en-GB", { weekday: "short" });
}

/** Parents come before their children in `orders`; depth comes from following `parentId`. */
function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const byParent = new Map<string | null, OrderRow[]>();
  for (const order of orders) {
    const list = byParent.get(order.parentId) ?? [];
    list.push(order);
    byParent.set(order.parentId, list);
  }
  const ids = new Set(orders.map((o) => o.id));
  // An order whose parent is not in the list (a filtered view) shows at the top level.
  const roots = orders.filter((o) => o.parentId === null || !ids.has(o.parentId));
  const rows = (list: OrderRow[], depth: number): React.ReactNode =>
    list.map((order) => {
      const stuck = order.state === "failed";
      return (
        <Fragment key={order.id}>
          <tr className={stuck ? "is-stuck" : depth ? undefined : "is-white"}>
            <td>
              <span className={depth ? "scr-order-child" : "scr-strong"} style={depth ? { paddingLeft: depth * 20 } : undefined}>
                {depth ? <span aria-hidden="true">↳ </span> : null}
                {depth ? <span className="scr-sr-only">Part of the order above: </span> : null}
                {order.title}
              </span>
            </td>
            <td>{DEPARTMENT_LABEL[order.department]}</td>
            <td className="scr-num">{due(order)}</td>
            <td className={`scr-num${stuck ? " scr-stuck-text" : ""}`}>
              {order.credits.used} / {order.credits.budget}
            </td>
            <td>
              <span className="scr-stuck-cell">
                <Chip tone={STATE_TONE[order.state]}>{order.stateText}</Chip>
                {order.approvalId && (order.state === "failed" || order.state === "waiting_founder") && (
                  <a href={`/app/inbox/${encodeURIComponent(order.approvalId)}`}>Open</a>
                )}
              </span>
            </td>
          </tr>
          {rows(byParent.get(order.id) ?? [], depth + 1)}
        </Fragment>
      );
    });
  return (
    <div className="scr-table-wrap">
      <table className="scr-table scr-orders">
        <thead>
          <tr>
            <th>Order</th>
            <th>Who</th>
            <th>Due</th>
            <th>Credits</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>{rows(roots, 0)}</tbody>
      </table>
    </div>
  );
}

function MemoryList({ notes, onForget }: { notes: Learned[]; onForget: (id: string) => void }) {
  return (
    <div className="scr-rows">
      {notes.map((note) => (
        <div key={note.id} className="scr-row scr-memory">
          <span className="scr-mono is-small">
            {KIND_LABEL[note.kind]} · {note.scope}
          </span>
          <b>{note.text}</b>
          <span className="scr-small scr-muted">{note.source}</span>
          {note.deletable && (
            <Button small variant="quiet" className="scr-memory-forget" aria-label={`Delete note: ${note.text}`} onClick={() => onForget(note.id)}>
              Delete
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
