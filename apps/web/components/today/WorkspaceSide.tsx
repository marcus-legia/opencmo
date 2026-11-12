"use client";

import { useScreen } from "@/components/screens/useScreen";
import { Sash } from "@/components/shell-v2/Sash";

import { ContextColumn } from "./ContextColumn";
import { LEFT, useTodayColumns } from "./columns";

/**
 * The left of the one working screen: the Context column and its sash. The shell draws it beside every view (Feed,
 * Calendar, Sales, Analytics), so what the CMO knows about the business stays in place while the centre changes.
 * The week's goal comes from the dashboard read the feed makes too (one request, shared).
 */
export function WorkspaceSide() {
  const [dash] = useScreen("dashboard");
  const sides = useTodayColumns();
  const week = dash.status === "ready" ? dash.data.week : null;
  return (
    <>
      <ContextColumn goal={week ? { text: week.goal, done: week.deliverables.done, total: week.deliverables.total } : null} />
      <Sash
        label="Resize the context column"
        controls="td-context"
        value={sides.columns.left}
        min={LEFT.min}
        max={LEFT.max}
        onLive={(value) => sides.live("left", value)}
        onCommit={(value) => sides.commit("left", value)}
        onReset={() => sides.commit("left", LEFT.base)}
      />
    </>
  );
}
