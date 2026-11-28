"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { isPlanRequired, PlanSheet } from "@/components/billing/PlanSheet";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { parsePlanUsage } from "@/lib/billing/usage";
import { TEXT_MAX, TEXT_PLATFORMS, connectedOnly, dayTargets, monthlyCredits, type PostingPlan } from "@/lib/cmo/posting-plan";
import { CONNECTABLE_PLATFORMS } from "@/lib/departments/publish/types";
import type { ScheduleScreen } from "@/lib/screens/schedule";

import { PlatformLogo, type LogoPlatform } from "./platform-logos";

const TEXT_LABEL: Record<(typeof TEXT_PLATFORMS)[number], string> = { x: "X", threads: "Threads", linkedin: "LinkedIn", facebook: "Facebook Page" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the plan costs the founder, in plain words: core posts a day (one post goes to each platform of its slot). */
export function planLine(plan: PostingPlan): string {
  return `Ferreto writes ${plural(dayTargets(plan).length, "post", "posts")} a day.`;
}

/**
 * The planner (daily core drafts, owner 2026-11-12): one row per text platform with its
 * logo and a stepper that reads "Off", "1 a day", "2 a week", saved on every change. The
 * week plan builds its skeleton from it, and saving moves the posts still only planned to the new platforms. A sample
 * screen changes only on this page.
 */
export function PostingPlanPanel({ initial, accounts, live, onSaved }: { initial: PostingPlan; accounts: ScheduleScreen["accounts"]; live: boolean; onSaved?: () => void }) {
  const [plan, setPlan] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(initial);
  const seq = useRef(0);
  // A reload of the screen brings the stored plan; a save in flight keeps what the founder just set.
  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    if (seq.current === 0) {
      saved.current = JSON.parse(initialKey) as PostingPlan;
      setPlan(saved.current);
    }
  }, [initialKey]);

  // The plan's monthly allowance, for the credit estimate (A3). Only a live plan reads it; a sample plan shows none.
  const [allowance, setAllowance] = useState<number | null>(null);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    api<{ usage?: unknown }>("/account")
      .then((account) => {
        const usage = parsePlanUsage(account.usage);
        if (alive) setAllowance(usage.plan === "pro" && usage.allowance > 0 ? usage.allowance : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [live]);

  const connected = (id: string) => accounts.some((a) => a.platform === id && a.status === "connected");
  const accountId = (id: string) => accounts.find((a) => a.platform === id && a.status === "connected")?.id ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  // Disconnecting cancels the posts waiting on that account, so it asks first.
  const [confirmOff, setConfirmOff] = useState<{ id: string; name: string; platform: string } | null>(null);
  // A sign-in is running in another tab: read the screen again when the founder comes back, so the row stops saying
  // "Not connected" without them reloading it.
  const [pendingConnect, setPendingConnect] = useState(false);
  // Connecting needs a plan (Zernio bills each account by the day): a free founder gets the plan sheet, not an error.
  const [planSheet, setPlanSheet] = useState(false);
  useEffect(() => {
    if (!pendingConnect) return;
    const back = () => {
      setPendingConnect(false);
      onSaved?.();
    };
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [pendingConnect, onSaved]);

  /**
   * Connect opens the platform's own sign-in in a new tab and Zernio brings the founder back to this page
   * (`from: "post"`). The row's state comes from the account that is actually connected, never from this click: a
   * sign-in the founder cancels must leave the row exactly as it was.
   */
  async function connect(platform: string, name: string) {
    if (!live) return setError("Sample plan: nothing is connected from this page.");
    if (busy) return;
    // The tab is opened inside the click. One opened after the request answers is a pop-up the browser blocks, and
    // `noopener` cannot be passed here: it makes `window.open` return null, leaving no tab to send anywhere. Clearing
    // `opener` on the new tab gives the same protection.
    const tab = window.open("about:blank", "_blank");
    setBusy(platform);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/accounts/connect", jsonBody({ platform, from: "post" }));
      if (!tab || tab.closed) {
        setError(`Your browser blocked the ${name} tab. Allow pop-ups for this site, then try again.`);
        return;
      }
      tab.opener = null;
      tab.location.replace(url);
      // This page still says "Not connected" until it is read again; it is, as soon as the founder comes back to it.
      setPendingConnect(true);
    } catch (err) {
      tab?.close();
      if (isPlanRequired(err)) setPlanSheet(true);
      else setError(err instanceof ApiError ? err.message : `Could not open ${name} to connect.`);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(target: { id: string; name: string; platform: string }) {
    setBusy(target.platform);
    setError(null);
    try {
      await api(`/accounts/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setConfirmOff(null);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not disconnect ${target.name}.`);
    } finally {
      setBusy(null);
    }
  }

  async function save(next: PostingPlan) {
    setPlan(next);
    setError(null);
    if (!live) return;
    const mine = ++seq.current;
    try {
      const res = await api<{ plan: PostingPlan }>("/cmo/posting-plan", jsonBody(next, "PUT"));
      saved.current = res.plan;
      // Only the last click's answer is shown: an earlier one landing late must not undo it.
      if (mine === seq.current) {
        setPlan(res.plan);
        seq.current = 0;
        onSaved?.();
      }
    } catch (err) {
      if (mine === seq.current) {
        setPlan(saved.current);
        seq.current = 0;
        setError(err instanceof ApiError ? err.message : "Could not save your posting plan.");
      }
    }
  }

  const set = (kind: "text" | "video", id: string, n: number) =>
    void save({ ...plan, [kind]: { ...plan[kind], [id]: n } } as PostingPlan);

  // What the plan really writes: a platform with no connected account writes nothing (`connectedOnly`), so the line
  // below counts only those. Saying "2 posts a day" while one of them is never written is a promise the product does
  // not keep.
  const running = connectedOnly(plan, TEXT_PLATFORMS.filter((id) => connected(id)));
  const posts = dayTargets(running).length;
  const credits = monthlyCredits(running);
  const on = TEXT_PLATFORMS.filter((id) => running.text[id] > 0).map((id) => TEXT_LABEL[id]);
  // Turned on in the plan, but there is no account to post to: the founder's counts are kept, nothing is written.
  const waiting = TEXT_PLATFORMS.filter((id) => plan.text[id] > 0 && !connected(id)).map((id) => TEXT_LABEL[id]);

  return (
    <section aria-label="Posting plan" id="posting-plan" data-testid="posting-plan" className="ui-card pp">
      {/* A <div>, not <header>: inside a section it would still read as a banner to some checkers. */}
      <div className="pp-head">
        <div>
          <h2>Posting plan</h2>
          <p>Pick where you post and how often. Ferreto writes to this plan.</p>
        </div>
        <span className="ui-chip" data-tone={live ? "ok" : undefined}>
          {live ? "Saved as you change it" : "Sample plan: changes stay on this page"}
        </span>
      </div>

      <div className="pp-groups">
        <div className="pp-group" role="group" aria-labelledby="pp-posts">
          <div className="pp-group-head">
            <div>
              <h3 id="pp-posts">Posts</h3>
              <p>Written for you every morning, for the platforms you connect here. One post goes to each of them.</p>
            </div>
          </div>
          {/* Facebook Pages are not connectable since 2026-11-22: its row stays only for a plan that still has it on. */}
          {TEXT_PLATFORMS.filter((id) => (CONNECTABLE_PLATFORMS as readonly string[]).includes(id) || plan.text[id] > 0).map((id) => (
            <Row
              key={id}
              platform={id}
              name={TEXT_LABEL[id]}
              per="day"
              value={plan.text[id]}
              max={TEXT_MAX[id]}
              connected={connected(id)}
              busy={busy === id}
              onConnect={
                (CONNECTABLE_PLATFORMS as readonly string[]).includes(id) && !connected(id) ? () => void connect(id, TEXT_LABEL[id]) : undefined
              }
              onDisconnect={(() => {
                const account = accountId(id);
                return account ? () => setConfirmOff({ id: account, name: TEXT_LABEL[id], platform: id }) : undefined;
              })()}
              onChange={(n) => set("text", id, n)}
            />
          ))}
        </div>
      </div>

      <div className="pp-sum">
        <p>
          <b data-testid="posting-plan-line">{planLine(running)}</b>{" "}
          {posts > 0 ? <span>{posts === 1 ? "It goes" : "They go"} to {listOf(on)}.</span> : <span>Connect a platform above to get a post every day.</span>}{" "}
          {waiting.length ? (
            <span data-testid="posting-plan-waiting">
              {listOf(waiting)} {waiting.length === 1 ? "is" : "are"} on in your plan with no account connected, so nothing is written for{" "}
              {waiting.length === 1 ? "it" : "them"}. Connect {waiting.length === 1 ? "it" : "them"} above to start.
            </span>
          ) : null}
        </p>
      </div>
      <div className="pp-credits" data-testid="posting-plan-credits">
        {credits > 0 ? (
          <p>
            Posts use about {credits} credits a month.{allowance !== null ? ` Your plan includes ${allowance}.` : null}
            {allowance !== null && credits > allowance ? (
              <span className="pp-over" data-testid="posting-plan-over">
                {" "}That is more than your plan includes, so some drafts would wait until it resets.
              </span>
            ) : null}
          </p>
        ) : null}
        <p>
          What to write: <Link href="/app?doc=post_plan&edit=1">edit your content plan</Link>
        </p>
      </div>
      {confirmOff ? (
        <div role="alertdialog" aria-label={`Disconnect ${confirmOff.name}`} className="pp-confirm">
          <p>
            Disconnect {confirmOff.name}? The posts already waiting to go out on it are cancelled, and nothing is
            written for it until you connect it again.
          </p>
          <div className="pp-confirm-acts">
            <button type="button" className="ui-btn ui-btn--danger" disabled={busy === confirmOff.platform} onClick={() => void disconnect(confirmOff)}>
              {busy === confirmOff.platform ? "Disconnecting…" : `Disconnect ${confirmOff.name}`}
            </button>
            <button type="button" className="ui-btn ui-btn--ghost" disabled={busy === confirmOff.platform} onClick={() => setConfirmOff(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="pp-error">
          {error}
        </p>
      ) : null}
      <PlanSheet open={planSheet} onClose={() => setPlanSheet(false)} action="connect an account" />
    </section>
  );
}

/** "X", "X and Threads", "X, Threads and LinkedIn". */
const listOf = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function Row({
  platform,
  name,
  per,
  value,
  max,
  connected,
  busy = false,
  onConnect,
  onDisconnect,
  onChange,
}: {
  platform: LogoPlatform;
  name: string;
  per: "day" | "week";
  value: number;
  max: number;
  connected: boolean;
  /** Busy while this platform's connect or disconnect is in flight. */
  busy?: boolean;
  /** Opens the platform's sign-in; absent on a row that cannot be connected (a Facebook Page since 2026-11-22). */
  onConnect?: () => void;
  /** Asks before removing the connection; absent while nothing is connected. */
  onDisconnect?: () => void;
  onChange: (n: number) => void;
}) {
  const unit = per === "day" ? "posts a day" : "videos a week";
  const off = value === 0;
  return (
    <div className="pp-row" data-off={off || undefined}>
      <PlatformLogo platform={platform} dim={off} />
      <div className="pp-who">
        <span className="pp-name">{name}</span>
        {connected ? (
          <span className="pp-state is-on">
            <i aria-hidden="true"></i>Connected{" "}
            {onDisconnect ? (
              <button type="button" className="pp-link" disabled={busy} onClick={onDisconnect}>
                Disconnect
              </button>
            ) : null}
          </span>
        ) : (
          <span className="pp-state">
            {/* Nothing is written for a platform with no account (`connectedOnly`), so the row says that, not that
                the post arrives to copy by hand. */}
            Not connected, so nothing is written for it.{" "}
            {onConnect ? (
              <button type="button" className="pp-link" disabled={busy} onClick={onConnect}>
                {busy ? "Opening…" : "Connect"}
              </button>
            ) : (
              <Link href="/app/settings#settings-connected-accounts">Settings</Link>
            )}
          </span>
        )}
      </div>
      <div className="pp-step">
        <button type="button" className="ui-btn ui-btn--quiet ui-btn--icon ui-btn--sm" aria-label={`Fewer ${unit} on ${name}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <output aria-label={`${name}: ${unit}`}>{off ? "Off" : `${value} a ${per}`}</output>
        <button type="button" className="ui-btn ui-btn--quiet ui-btn--icon ui-btn--sm" aria-label={`More ${unit} on ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
