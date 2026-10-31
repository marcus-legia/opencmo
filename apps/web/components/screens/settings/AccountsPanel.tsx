"use client";

/**
 * Settings → Accounts (P4 C1): one row per platform OpenCMO posts to. Connect opens Zernio's link for that platform
 * (B2 `POST /accounts/connect`); Zernio sends the founder back through `/accounts/callback`, which lands here with
 * `?connected=<platform>` or `?connect_error=<sentence>`. Disconnect asks first, then removes it at Zernio and here.
 */

import { useEffect, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { Button } from "@/components/ui";
import { PLATFORM_LABEL, PLATFORMS, type Platform } from "@/lib/screens/common";
import type { SettingsScreen } from "@/lib/screens/settings";

import { cx, Panel } from "../parts";

type Account = SettingsScreen["accounts"][number];

export const ACCOUNTS_PANEL_ID = "settings-connected-accounts";

const SAMPLE = "These are sample accounts: nothing connects from here.";

/** The callback's answer, read once and taken out of the address so a reload does not show it again. */
function callbackNote(): { ok: boolean; text: string } | null {
  const url = new URL(window.location.href);
  const connected = url.searchParams.get("connected");
  const error = url.searchParams.get("connect_error");
  if (!connected && !error) return null;
  for (const key of ["connected", "connect_error", "tab"]) url.searchParams.delete(key);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (error) return { ok: false, text: error.slice(0, 300) };
  const platform = (PLATFORMS as readonly string[]).includes(connected!) ? PLATFORM_LABEL[connected as Platform] : "Your account";
  return { ok: true, text: `${platform} is connected. Posts you approve go out on it at the times you approved.` };
}

export function AccountsPanel({ accounts: given, live }: { accounts: Account[]; live: boolean }) {
  const [accounts, setAccounts] = useState(given);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setAccounts(given), [given]);
  useEffect(() => {
    const back = callbackNote();
    if (!back) return;
    setNote(back);
    document.getElementById(ACCOUNTS_PANEL_ID)?.scrollIntoView({ block: "start" });
  }, []);

  async function connect(account: Account) {
    if (!live || busy) return;
    setBusy(account.id);
    setNote(null);
    try {
      const { url } = await api<{ url: string }>("/accounts/connect", jsonBody({ platform: account.platform }));
      // Zernio's own page: it asks the platform, then sends the founder back here.
      window.location.assign(url);
    } catch (error) {
      setNote({ ok: false, text: error instanceof ApiError ? error.message : "Could not open the connect page. Please try again." });
      setBusy(null);
    }
  }

  async function disconnect(account: Account) {
    if (!live || busy) return;
    setBusy(account.id);
    setNote(null);
    try {
      await api(`/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
      setAccounts((list) =>
        list.map((a) => (a.id === account.id ? { ...a, id: `connect-${a.platform}`, handle: "", status: "not_connected", avatarUrl: null, syncedAt: null, noDataSince: null } : a)),
      );
      setNote({ ok: true, text: `${PLATFORM_LABEL[account.platform]} is disconnected. Nothing posts to it until you connect it again.` });
      setConfirming(null);
    } catch (error) {
      setNote({ ok: false, text: error instanceof ApiError ? error.message : "Could not disconnect. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel id={ACCOUNTS_PANEL_ID} title="Connected accounts" sub="Posts go out on your own accounts, only at times you approved. One account per platform.">
      {note ? (
        <p className={cx("v2-panel-body", note.ok ? "scr-status-line is-ok" : "scr-status-line is-stuck")} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      ) : null}
      {accounts.length === 0 ? (
        <p className="v2-panel-body scr-muted">No platforms to connect yet.</p>
      ) : (
        <div className="scr-accounts">
          {accounts.map((a) => {
            const name = PLATFORM_LABEL[a.platform];
            const waiting = busy === a.id;
            return (
              <div key={a.id} className={cx("scr-account", a.status === "reconnect" && "is-stuck")} data-testid="settings-account" data-platform={a.platform}>
                <span className="scr-account-who">
                  {a.avatarUrl ? <img src={a.avatarUrl} alt="" width={24} height={24} /> : null}
                  <span>
                    <b>{name}</b>
                    {a.handle ? ` · ${a.handle}` : ""}
                    {a.status === "reconnect" ? <span className="scr-status is-stuck scr-account-note">Stopped working: connect it again</span> : null}
                  </span>
                </span>
                {confirming === a.id ? (
                  <span className="v2-actions" role="group" aria-label={`Disconnect ${name}?`}>
                    <Button compact variant="danger" disabled={waiting} onClick={() => void disconnect(a)}>
                      Disconnect {name}
                    </Button>
                    <Button compact variant="quiet" disabled={waiting} onClick={() => setConfirming(null)}>
                      Keep it
                    </Button>
                  </span>
                ) : a.status === "connected" ? (
                  <span className="v2-actions">
                    <span className="scr-status is-ok">Connected</span>
                    <Button compact variant="quiet" disabled={!live || !!busy} title={live ? undefined : SAMPLE} onClick={() => setConfirming(a.id)}>
                      Disconnect
                    </Button>
                  </span>
                ) : (
                  <Button
                    compact
                    variant={a.status === "reconnect" ? "danger" : "secondary"}
                    disabled={!live || !!busy}
                    title={live ? undefined : SAMPLE}
                    onClick={() => void connect(a)}
                  >
                    {waiting ? "Opening…" : `${a.status === "reconnect" ? "Reconnect" : "Connect"} ${name}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {confirming ? (
        <p className="v2-panel-body scr-small scr-muted">Disconnecting removes OpenCMO's access to the account. Nothing is posted to it after that.</p>
      ) : null}
    </Panel>
  );
}
