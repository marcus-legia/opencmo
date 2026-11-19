"use client";

import { useEffect, useState } from "react";

import { OPEN_USAGE_STATE, parseUsageState, type UsageState, type UsageWork } from "@/lib/billing/usage";
import { createClient } from "@/lib/supabase/client";

import { PlanSheet } from "./PlanSheet";

/**
 * What a founder sees when included work has stopped (wave 4 C2): at 100% of a paid plan's allowance, a banner on Sales,
 * Post and Feed; after a free account's free scan, one locked card on Post and Feed. Both read `my_usage_state()` (A1).
 * SQL refuses the stopped work on its own; these only say so before the founder presses a button.
 */

/** Read once per screen. Until it answers (or if it fails) nothing is shown: no lock over work that still runs. */
export function useUsageState(): UsageState | null {
  const [state, setState] = useState<UsageState | null>(null);
  useEffect(() => {
    let alive = true;
    void createClient()
      .rpc("my_usage_state")
      .then(({ data, error }) => {
        if (alive) setState(error ? { ...OPEN_USAGE_STATE } : parseUsageState(data));
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

const STOPPED_WORDS: Record<UsageWork, string> = {
  read: "reading what Ferreto found",
  edit: "editing",
  copy_drafts: "copying your drafts",
  post_drafts: "new post drafts",
  reply_drafts: "reply drafts",
  sales_scan: "new scans",
  research: "competitor research",
};

/** "a, b and c". */
export function listOf(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "");
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const resetDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null);

/** What stopped, from SQL's list, as one phrase: "New scans and competitor research". */
export function stoppedLine(state: UsageState): string {
  return capital(listOf(state.stopped.map((w) => STOPPED_WORDS[w])));
}

/**
 * 100% of the month's allowance used (paid plans): what stopped and until when, what still works, and the way to the
 * plans. Shown on Sales, Post and Feed.
 */
export function AllowanceBanner({ state, testId = "usage-allowance-used" }: { state: UsageState | null; testId?: string }) {
  if (!state || state.reason !== "allowance_used") return null;
  const stopped = stoppedLine(state);
  const day = resetDay(state.resetsAt);
  return (
    <div className="card td-usage-notice" role="status" data-testid={testId}>
      <div style={{ flex: "1 1 260px", minWidth: "0" }}>
        <b>You used 100% of this month&apos;s allowance</b>
        <div className="meta">
          {stopped ? `${stopped} stop until ${day ?? "the allowance resets"}.` : `New work waits until ${day ?? "the allowance resets"}.`} The people
          already found, your drafts and your posts keep working.
        </div>
      </div>
      <a href="/app/billing#billing-plans" className="ghost" style={{ textDecoration: "none" }}>
        See plans
      </a>
    </div>
  );
}

/**
 * A free account after its free scan, on Post and Feed: one locked card with the reason and the plan. `where` picks
 * the first sentence; the rest comes from what SQL says stopped.
 */
export function FreeLockedCard({ state, where }: { state: UsageState | null; where: "post" | "feed" }) {
  const [plans, setPlans] = useState(false);
  if (!state || state.reason !== "free_scan_used") return null;
  const stopped = stoppedLine(state);
  const title =
    where === "post"
      ? state.stopped.includes("post_drafts")
        ? "Your free post draft is used"
        : "Your free scan is used"
      : "Your free scan is done";
  const lead =
    where === "post"
      ? "Post writes from what people said in your scans, so the next drafts come with a plan."
      : "You have seen who is asking. Writing to them, and finding more people, comes with a plan.";
  return (
    <section className="card td-usage-notice td-locked" data-testid={`free-locked-${where}`} aria-labelledby={`free-locked-${where}-title`}>
      <span className="td-lock" aria-hidden="true">
        <svg className="i s" viewBox="0 0 24 24">
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>
      <div style={{ flex: "1 1 240px", minWidth: "0" }}>
        <b id={`free-locked-${where}-title`}>{title}</b>
        <div className="meta">
          {lead}
          {stopped ? ` Locked: ${stopped.charAt(0).toLowerCase()}${stopped.slice(1)}.` : ""} The people already found and the
          drafts you have stay yours.
        </div>
      </div>
      <button type="button" className="primary" onClick={() => setPlans(true)}>
        See plans
      </button>
      <PlanSheet open={plans} onClose={() => setPlans(false)} action={where === "post" ? "write more posts" : "reply to these people"} />
    </section>
  );
}
