"use client";

import { Fragment, useState } from "react";

import { Button, Chip, LinkButton, PageHeader, Panel, Screen, Tabs } from "../kit";
import { useTabParam } from "../useTabParam";
import { PauseButton } from "./PauseButton";
import { BRAIN_SAMPLE, type BrainScreenData, type MemoryNote, type OrderState, type WorkOrder } from "./data";

const TABS = [
  { id: "week", label: "This week" },
  { id: "memory", label: "Memory" },
  { id: "past", label: "Past weeks" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function BrainScreen({ data = BRAIN_SAMPLE, live = false }: { data?: BrainScreenData; live?: boolean }) {
  const [tab, setTab] = useTabParam<Tab>("tab", TABS.map((t) => t.id), "week");
  const [memory, setMemory] = useState(data.memory);
  const forget = (id: string) => setMemory((all) => all.filter((note) => note.id !== id));

  return (
    <Screen label="Brain">
      <PageHeader
        eyebrow="Brain · thinks with OpenCMO's model"
        title="The plan, the orders, what it learned."
        sample={!live}
        actions={
          <>
            <LinkButton href="/app?ask=1">Ask your CMO</LinkButton>
            <PauseButton />
          </>
        }
      />
      <Tabs label="Brain views" tabs={[...TABS]} value={tab} onChange={setTab} />

      {tab === "week" && (
        <div className="scr-split">
          <Panel
            className="scr-main"
            title={`Orders · goal: ${data.goal}`}
            aside={
              <span className="scr-small scr-muted">
                {data.ordersDone} of {data.ordersTotal} done · {data.creditsUsed} of {data.creditsBudget} credits
              </span>
            }
            foot={`The daily check runs at ${data.checkTime}. Only a stuck order costs a replan.`}
          >
            <OrdersTable orders={data.orders} />
          </Panel>
          <Panel as="aside" className="scr-side" title="Learned lately" sub="Each note shows where it came from. Delete any.">
            <MemoryList notes={memory.slice(0, 4)} onForget={forget} />
          </Panel>
        </div>
      )}

      {tab === "memory" && (
        <Panel
          title="Memory"
          sub="Lessons from results, rules from your edits, reasons you skipped things. Newer notes win; delete any you don't agree with."
        >
          {memory.length ? (
            <MemoryList notes={memory} onForget={forget} />
          ) : (
            <p className="scr-panel-body scr-muted">Nothing learned yet. Notes appear after your first week of approvals.</p>
          )}
        </Panel>
      )}

      {tab === "past" && (
        <Panel title="Past weeks" sub="Each Sunday the Brain closes the week against its goal.">
          <div className="scr-table-wrap">
            <table className="scr-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Goal</th>
                  <th>Orders done</th>
                  <th>Credits</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {data.pastWeeks.map((week) => (
                  <tr key={week.id}>
                    <td className="scr-num">{week.week}</td>
                    <td><b className="scr-strong">{week.goal}</b></td>
                    <td className="scr-num">{week.done} / {week.total}</td>
                    <td className="scr-num">{week.creditsUsed} / {week.creditsBudget}</td>
                    <td>{week.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </Screen>
  );
}

function OrdersTable({ orders }: { orders: WorkOrder[] }) {
  const rows = (list: WorkOrder[], depth: number): React.ReactNode =>
    list.map((order) => (
      <Fragment key={order.id}>
        <tr className={order.state.kind === "stuck" ? "is-stuck" : depth ? undefined : "is-white"}>
          <td>
            <span className={depth ? "scr-order-child" : "scr-strong"} style={depth ? { paddingLeft: (depth - 1) * 20 + 20 } : undefined}>
              {depth ? <span aria-hidden="true">↳ </span> : null}
              {depth ? <span className="scr-sr-only">Part of the order above: </span> : null}
              {order.title}
            </span>
          </td>
          <td>{order.who}</td>
          <td className="scr-num">{order.due}</td>
          <td className={`scr-num${order.state.kind === "stuck" ? " scr-stuck-text" : ""}`}>
            {order.creditsUsed} / {order.creditsBudget}
          </td>
          <td>
            <StateChip state={order.state} />
          </td>
        </tr>
        {order.children ? rows(order.children, depth + 1) : null}
      </Fragment>
    ));
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
        <tbody>{rows(orders, 0)}</tbody>
      </table>
    </div>
  );
}

export function StateChip({ state }: { state: OrderState }) {
  switch (state.kind) {
    case "running":
      return <Chip tone="running">Running</Chip>;
    case "done":
      return <Chip tone="posted">Done</Chip>;
    case "queued":
      return <Chip tone="idle">Queued</Chip>;
    case "waits_on":
      return <Chip tone="idle">Waits on {state.what}</Chip>;
    case "waits_on_you":
      return <Chip tone="waiting">{state.count} waits on you</Chip>;
    case "stuck":
      return (
        <span className="scr-stuck-cell">
          <Chip tone="stuck">Stuck: {state.reason}</Chip>
          {state.href && <a href={state.href}>Open</a>}
        </span>
      );
  }
}

function MemoryList({ notes, onForget }: { notes: MemoryNote[]; onForget: (id: string) => void }) {
  return (
    <div className="scr-rows">
      {notes.map((note) => (
        <div key={note.id} className="scr-row scr-memory">
          <span className="scr-mono is-small">{note.kind}</span>
          <b>{note.text}</b>
          <span className="scr-small scr-muted">{note.source}</span>
          <Button small variant="quiet" className="scr-memory-forget" aria-label={`Delete note: ${note.text}`} onClick={() => onForget(note.id)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}
