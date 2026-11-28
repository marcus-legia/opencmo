"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import type { AccountSummary } from "@/components/clipping/web/AccountUsage";
import { ApiKeys } from "@/components/clipping/web/ApiKeys";
import { ConnectedApps } from "@/components/clipping/web/ConnectedApps";
import { ThemeSwitch } from "@/components/theme";
import { Button, MonoLabel } from "@/components/ui";
import { formatBytes } from "@/lib/upload";
import { AUTOPILOT_HOURS, AUTOPILOT_PLATFORMS, BUDGET_MAX, BUDGET_MIN, type Autopilot, type SettingsScreen as Data } from "@/lib/screens/settings";

import { publishAutopilot, useAutopilotChanges } from "@/components/today/autopilot";
import { PageHeader as UiPageHeader } from "@/components/today/PageHeader";

import { PauseButton } from "../brain/PauseButton";
import { cx, ErrorNote, PageHeader, Panel, Screen, SkeletonBlocks } from "../parts";
import { isSample, useScreen } from "../useScreen";
import { ACCOUNTS_PANEL_ID, AccountsPanel } from "./AccountsPanel";
import { DeleteAccount } from "./DeleteAccount";
import { NotifyPanel } from "./NotifyPanel";
import { SalesScansPanel } from "./SalesScansPanel";
import { TrackingPanel } from "./TrackingPanel";


function zones(current: string): string[] {
  // Every zone the browser knows; the RPC checks the name against Postgres' list on save.
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

function offset(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part ? ` (${part.value.replace("GMT", "UTC")})` : "";
  } catch {
    return "";
  }
}

export function SettingsScreen({ mcpEndpoint, paid, editor = false }: { mcpEndpoint: string | null; paid: boolean; editor?: boolean }) {
  const [state] = useScreen("settings");

  return (
    <div className="v2 scr td-cardhost td-v2host" data-testid="v2-settings">
      <UiPageHeader title="Settings" status={state.status === "ready" && isSample(state.live) ? "Sample data" : "Connected accounts, Sales scans, planning and notifications"} />
        <div className="td-settings-body">
          {state.status === "loading" && <SkeletonBlocks />}
          {state.status === "error" && <ErrorNote>{state.message}</ErrorNote>}
          {state.status === "ready" && <SettingsBody data={state.data} live={state.live} editor={editor} />}
          <section aria-labelledby="appearance-title" className="v2-panel" data-testid="settings-appearance">
            <h2 id="appearance-title">Appearance</h2>
            <p className="scr-tiny scr-muted">System follows your computer&apos;s light or dark mode.</p>
            <ThemeSwitch />
          </section>
          {/* Today's account, API keys and connected apps: kept whole so nothing the old page did is lost. */}
          <AccountPanel paid={paid} editor={editor} />
          {/* The MCP server's tools are all the editor's (packages/mcp-server): with the editor off in production, a key
              would connect to nothing the founder can use (E2E 2026-11-22). */}
          {editor ? (
            <div id="api-keys" className="scr-legacy-cards">
              <ApiKeys endpoint={mcpEndpoint} paid={paid} />
              <ConnectedApps paid={paid} />
            </div>
          ) : null}
        </div>
    </div>
  );
}

const AUTOPILOT_LABEL: Record<(typeof AUTOPILOT_PLATFORMS)[number], string> = { x: "X", threads: "Threads", linkedin: "LinkedIn" };

/**
 * Autopilot (owner, 2026-11-12): posts on a connected account go out without Approve, after a review window. Saved on
 * every change, on its own route, so a slip of the hand on the budget field never turns it on.
 */
function AutopilotField({ initial, accounts, live }: { initial: Autopilot; accounts: Data["accounts"]; live: boolean }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = (id: string) => accounts.some((a) => a.platform === id && a.status === "connected");
  // The top bar's switch changes the same setting while this block is on screen.
  useAutopilotChanges(useCallback((next: Autopilot) => setValue(next), []));

  async function send(request: Pick<Autopilot, "platforms" | "hours"> | { paused: boolean }) {
    setBusy(true);
    setError(null);
    try {
      // Sample settings change only on this page.
      const next = live
        ? await api<Autopilot>("/cmo/autopilot", jsonBody(request, "paused" in request ? "PATCH" : "PUT"))
        : { ...value, ...request, note: null };
      setValue(next);
      publishAutopilot(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="v2-field scr-radios" data-testid="settings-autopilot">
      <legend>Post without asking me</legend>
      {value.paused && value.platforms.length > 0 ? (
        <span role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <span className="scr-small">Autopilot is off from the top bar. Your choices are kept; every post waits for your Approve.</span>
          <Button variant="secondary" disabled={busy} onClick={() => void send({ paused: false })}>
            Turn on
          </Button>
        </span>
      ) : null}
      {AUTOPILOT_PLATFORMS.map((id) => {
        const on = value.platforms.includes(id);
        const ready = connected(id);
        return (
          <label key={id} className={cx("scr-radio", on && "is-on")}>
            <input
              type="checkbox"
              checked={on}
              disabled={busy || (!ready && !on)}
              onChange={() => void send({ platforms: on ? value.platforms.filter((p) => p !== id) : [...value.platforms, id], hours: value.hours })}
            />
            <span>
              <b>{AUTOPILOT_LABEL[id]}</b>
              <span className="scr-tiny scr-muted">{ready ? (on ? "Posts go out at their time unless you change them." : "Every post waits for your Approve.") : "Connect this account first."}</span>
            </span>
          </label>
        );
      })}
      <label className="v2-field" htmlFor="autopilot-hours">
        Time to change a post first
        <select
          id="autopilot-hours"
          className="v2-input"
          value={value.hours}
          disabled={busy}
          onChange={(e) => void send({ platforms: value.platforms, hours: Number(e.target.value) as Autopilot["hours"] })}
        >
          {AUTOPILOT_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {hours} hours
            </option>
          ))}
        </select>
      </label>
      {value.note ? <span className="scr-tiny scr-stuck-text" role="status">{value.note}</span> : null}
      {error && <ErrorNote>{error}</ErrorNote>}
      <span className="scr-tiny scr-muted">
        Single posts only. Replies, threads and anything you briefed in the chat always wait for you. Skip three in a row and it turns itself off.
      </span>
    </fieldset>
  );
}

function SettingsBody({ data, live, editor }: { data: Data; live: Record<keyof Data, boolean>; editor: boolean }) {
  const [budget, setBudget] = useState(String(data.weeklyCreditBudget));
  const [timezone, setTimezone] = useState(data.timezone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pausedAt, setPausedAt] = useState(data.cmo.pausedAt);
  const zoneList = useMemo(() => zones(data.timezone), [data.timezone]);
  const savesForReal = live.weeklyCreditBudget && live.timezone;
  const budgetNumber = Number(budget);
  const budgetOk = budget.trim() !== "" && Number.isInteger(budgetNumber) && budgetNumber >= BUDGET_MIN && budgetNumber <= BUDGET_MAX;
  const dirty = budgetNumber !== data.weeklyCreditBudget || timezone !== data.timezone;

  async function save() {
    if (!budgetOk) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Sample settings change only on this page; live ones go through `save_cmo_settings` (brain plan W1-1).
      if (savesForReal) await api("/cmo/settings", jsonBody({ weeklyCreditBudget: budgetNumber, timezone }, "PUT"));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AccountsPanel accounts={data.accounts} live={live.accounts} />
      <SalesScansPanel />
      <TrackingPanel />

      <div className="scr-settings-grid">
        <Panel id="settings-your-cmo" title="Planning" className="scr-settings-cmo">
          <form
            className="v2-panel-body scr-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="v2-field" htmlFor="budget">
              Weekly limit
              <span className="scr-inline-field">
                <input
                  id="budget"
                  className="v2-input scr-input-short scr-num"
                  inputMode="numeric"
                  value={budget}
                  aria-invalid={!budgetOk}
                  aria-describedby="budget-note"
                  onChange={(e) => {
                    setBudget(e.target.value.replace(/[^0-9]/g, ""));
                    setSaved(false);
                  }}
                />
                <span id="budget-note" className="scr-small">
                  credits a week, out of your plan&apos;s monthly allowance
                </span>
              </span>
            </label>
            {!budgetOk && <span className="scr-tiny scr-stuck-text">Use a whole number from {BUDGET_MIN} to {BUDGET_MAX.toLocaleString("en-US")}.</span>}
            <label className="v2-field" htmlFor="timezone">
              Your time zone
              <select
                id="timezone"
                className="v2-input"
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setSaved(false);
                }}
              >
                {zoneList.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                    {zone === timezone ? offset(zone) : ""}
                  </option>
                ))}
              </select>
            </label>
            <AutopilotField initial={data.autopilot} accounts={data.accounts} live={live.autopilot} />
            {error && <ErrorNote>{error}</ErrorNote>}
            <span className="v2-actions">
              <Button type="submit" variant="on-dark" disabled={!dirty || !budgetOk || saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {saved && (
                <span role="status" className="scr-small scr-ok-text">
                  Saved. The next brief uses it.
                </span>
              )}
            </span>
          </form>
        </Panel>

        <section aria-labelledby="off-title" className="v2-panel scr-dark scr-off">
          <MonoLabel small>Off switch</MonoLabel>
          <h2 id="off-title">
            {pausedAt ? "Ferreto is paused. Nothing runs and nothing posts." : "Pause stops every order and every scheduled post within a minute."}
          </h2>
          <p>Nothing is deleted. Resume picks up where it stopped; posts whose time passed ask you again.</p>
          <span>
            <PauseButton variant="on-dark" pausedAt={pausedAt} live={live.cmo} onChange={setPausedAt} />
          </span>
          <div className="scr-off-foot">
            <span className="scr-off-plan">
              <span>Plan</span>
              <span className="scr-num">
                {data.plan.name}
              </span>
            </span>
            <span className="scr-off-links">
              <a href="/app/billing">Billing</a>
              <a href="/app/business?d=brand">Brand</a>
              {editor ? <a href="#api-keys">API keys</a> : null}
            </span>
          </div>
        </section>
      </div>

      <NotifyPanel digestDays={data.digestDays} digestHour={data.digestHour} emailLog={data.emailLog} timezone={data.timezone} live={live.digestDays && live.digestHour} />
    </>
  );
}

function AccountPanel({ paid, editor }: { paid: boolean; editor: boolean }) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<AccountSummary>("/account")
      .then((value) => alive && setAccount(value))
      .catch((err: unknown) => alive && setError(err instanceof ApiError ? err.message : "Could not load your account."));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Panel id="settings-account"
      title="Account"
      actions={
        <form action="/auth/signout" method="post">
          <Button type="submit" compact variant="secondary">
            Sign out
          </Button>
        </form>
      }
      // The editor's retention line only where the editor is reachable (off in production, `lib/editor-flag.ts`).
      foot={editor ? "Clips and uploads are removed 7 days after a project finishes; downloads of whole videos are removed after 24 hours. Export what you want to keep before then. You are responsible for the rights to the videos you submit." : undefined}
    >
      <div className="v2-panel-body scr-small">
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : !account ? (
          <span className="scr-muted">Loading…</span>
        ) : (
          <span className="scr-account-line">
            <span>
              Signed in as <b>{account.email}</b>
            </span>
            <span>
              Storage{" "}
              <b className="scr-num">
                {formatBytes(account.quota.storage.bytes)} / {formatBytes(account.quota.storage.limit)}
              </b>
            </span>
            <a href="/app/billing">Usage and limits →</a>
          </span>
        )}
      </div>
      {account ? <DeleteAccount email={account.email} paid={paid} /> : null}
    </Panel>
  );
}
