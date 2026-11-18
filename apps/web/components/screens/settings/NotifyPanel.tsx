"use client";

import { useEffect, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { Button } from "@/components/ui";

import { DIGEST_DAYS, digestScheduleLabel, type DigestDays } from "@/lib/cmo/digest";
import type { EmailLogEntry } from "@/lib/screens/settings";

import { ErrorNote, Panel } from "../parts";

type Notify = { emailDigest: boolean; push: boolean; vapidPublicKey: string | null };
type PushState = "unsupported" | "needs_home_screen" | "denied" | "off" | "on" | "busy";

/** The VAPID key as the bytes `pushManager.subscribe` wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** iPhone and iPad only deliver push to a site added to the Home Screen and opened from there (iOS 16.4+). */
function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

const KIND: Record<EmailLogEntry["kind"], string> = { digest: "Morning email", weekly: "Weekly report", push: "Push", expiring: "Expiring card" };
const DAYS_LABEL: Record<DigestDays, string> = { weekdays: "Weekdays", daily: "Every day", monday: "Mondays", off: "Off" };
const HOURS = [6, 7, 8, 9, 10, 12, 18];

/** "3 people · 1 follow-up · 2 posts", or why the morning was skipped. */
function summaryLine(entry: EmailLogEntry): string | null {
  const s = entry.summary;
  if (!s) return null;
  if (s.note) return s.note;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [n(s.people, "person asking", "people asking"), n(s.followUps, "follow-up", "follow-ups"), n(s.posts, "post", "posts")].join(" · ");
}

function when(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("en-GB");
  }
}

type Props = {
  digestDays: DigestDays;
  digestHour: number | null;
  emailLog: EmailLogEntry[];
  timezone: string;
  /** False on sample data: the schedule changes on this page only. */
  live: boolean;
};

/**
 * Notifications (wave 2 C3): when the morning email comes, push on this device, and the log of what was sent or skipped
 * in the last 14 days. Both only tell the founder what waits; the card is decided in the app. Push is per browser, so the
 * button speaks of "this device".
 */
export function NotifyPanel({ digestDays, digestHour, emailLog, timezone, live }: Props) {
  const [settings, setSettings] = useState<Notify | null>(null);
  const [push, setPush] = useState<PushState>("busy");
  const [error, setError] = useState<string | null>(null);
  // `digest_hour` null was the old way to turn it off: it reads as Off here, and a new schedule brings back 08:00.
  const [days, setDays] = useState<DigestDays>(digestHour === null ? "off" : digestDays);
  const [hour, setHour] = useState<number>(digestHour ?? 8);
  const [saved, setSaved] = useState<{ days: DigestDays; hour: number }>({ days: digestHour === null ? "off" : digestDays, hour: digestHour ?? 8 });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Notify>("/notify")
      .then(async (value) => {
        if (!alive) return;
        setSettings(value);
        // The emails' own switch (`notify_settings.email_digest`) off means no email whatever the schedule says.
        if (!value.emailDigest) {
          setDays("off");
          setSaved((was) => ({ ...was, days: "off" }));
        }
        if (!value.vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
          setPush(needsHomeScreenSafe() ? "needs_home_screen" : "unsupported");
          return;
        }
        if (Notification.permission === "denied") return setPush("denied");
        setPush((await currentSubscription()) ? "on" : "off");
      })
      .catch((err: unknown) => alive && setError(err instanceof ApiError ? err.message : "Could not load your notification settings."));
    return () => {
      alive = false;
    };
  }, []);

  const dirty = days !== saved.days || (days !== "off" && hour !== saved.hour);

  async function saveSchedule() {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      if (live) {
        await api("/cmo/settings", jsonBody(days === "off" ? { digestDays: "off" } : { digestDays: days, digestHour: hour }, "PUT"));
        // Turning a schedule on also turns the emails back on if they were stopped.
        if (days !== "off" && settings && !settings.emailDigest) {
          setSettings({ ...settings, ...(await api<Pick<Notify, "emailDigest" | "push">>("/notify", jsonBody({ emailDigest: true, push: settings.push }, "PUT"))) });
        }
      }
      setSaved({ days, hour });
      setNote(days === "off" ? "Saved. No morning email; everything still waits for you here." : `Saved. It comes ${digestScheduleLabel(days, hour)} (${timezone}).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function turnPushOn() {
    if (!settings?.vapidPublicKey) return;
    setError(null);
    setPush("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setPush(permission === "denied" ? "denied" : "off");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.vapidPublicKey) }));
      await api("/notify/push", jsonBody(subscription.toJSON(), "POST"));
      if (!settings.push) setSettings({ ...settings, ...(await api<Pick<Notify, "emailDigest" | "push">>("/notify", jsonBody({ emailDigest: settings.emailDigest, push: true }, "PUT"))) });
      setPush("on");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "This browser did not turn push on. Try again, or use email.");
      setPush((await currentSubscription().catch(() => null)) ? "on" : "off");
    }
  }

  async function turnPushOff() {
    setError(null);
    setPush("busy");
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await api("/notify/push", jsonBody({ endpoint: subscription.endpoint }, "DELETE"));
        await subscription.unsubscribe();
      }
      setPush("off");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not turn push off. Try again.");
      setPush("on");
    }
  }

  return (
    <Panel id="settings-notify" title="Notifications" sub="They only tell you what waits. You decide in the app, never from an email or a push.">
      {/* The morning email's footer links here ("Change when it comes"). */}
      <span id="notifications" aria-hidden="true" />
      <div className="v2-panel-body scr-form">
        {settings ? (
          <>
            <form
              className="v2-field"
              data-testid="digest-schedule"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSchedule();
              }}
            >
              <span>Morning email</span>
              <span className="scr-inline-field" style={{ flexWrap: "wrap" }}>
                <label className="scr-small" htmlFor="digest-days">
                  When
                </label>
                <select
                  id="digest-days"
                  className="v2-input"
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value as DigestDays);
                    setNote(null);
                  }}
                >
                  {DIGEST_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DAYS_LABEL[d]}
                    </option>
                  ))}
                </select>
                {days !== "off" ? (
                  <>
                    <label className="scr-small" htmlFor="digest-hour">
                      at
                    </label>
                    <select id="digest-hour" className="v2-input" value={hour} onChange={(e) => (setHour(Number(e.target.value)), setNote(null))}>
                      {[...new Set([...HOURS, hour])]
                        .sort((x, y) => x - y)
                        .map((h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00
                          </option>
                        ))}
                    </select>
                  </>
                ) : null}
                <Button compact variant="secondary" type="submit" disabled={!dirty || saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </span>
              <span className="scr-small scr-muted">
                People asking come first, then follow-ups and the posts that wait. A morning with nothing new sends nothing.
              </span>
              {note ? (
                <span role="status" className="scr-small scr-ok-text">
                  {note}
                </span>
              ) : null}
            </form>
            <div className="v2-field" data-testid="push-setting">
              <span>Push on this device</span>
              {push === "on" ? (
                <span className="scr-inline-field">
                  <span className="scr-small">On: a push when new cards wait, and before an autopilot post goes out.</span>
                  <Button compact variant="secondary" onClick={() => void turnPushOff()}>
                    Turn off
                  </Button>
                </span>
              ) : push === "off" ? (
                <span className="scr-inline-field">
                  <span className="scr-small">Your browser asks you first.</span>
                  <Button compact variant="secondary" onClick={() => void turnPushOn()}>
                    Turn on
                  </Button>
                </span>
              ) : push === "busy" ? (
                <span className="scr-small scr-muted">Checking…</span>
              ) : push === "denied" ? (
                <span className="scr-small">This browser blocks notifications from Ferreto. Allow them in the browser&apos;s site settings, then come back.</span>
              ) : push === "needs_home_screen" ? (
                <span className="scr-small">
                  On iPhone and iPad, add Ferreto to your Home Screen first (Share, then Add to Home Screen), open it from there, and turn push on in Settings. Email works everywhere.
                </span>
              ) : (
                <span className="scr-small">This browser cannot get push from Ferreto. Email works everywhere.</span>
              )}
            </div>
          </>
        ) : !error ? (
          <span className="scr-small scr-muted">Loading…</span>
        ) : null}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="v2-field" data-testid="email-log">
          <span>Sent and skipped, last 14 days</span>
          {emailLog.length === 0 ? (
            <span className="scr-small scr-muted">Nothing yet. The first morning email shows here, and so does a morning with nothing new.</span>
          ) : (
            <div style={{ overflowX: "auto", maxWidth: "100%" }}>
              <table className="v2-table scr-table-compact">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {emailLog.map((entry) => {
                    const line = summaryLine(entry);
                    return (
                      <tr key={entry.id} data-status={entry.status}>
                        <td className="scr-num" style={{ whiteSpace: "nowrap" }}>{when(entry.at, timezone)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{KIND[entry.kind]}</td>
                        <td>
                          {entry.subject ?? <span className="scr-muted">No email</span>}
                          {line ? <div className="scr-tiny scr-muted">{line}</div> : null}
                        </td>
                        <td>{entry.status === "sent" ? "Sent" : "Skipped"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function needsHomeScreenSafe(): boolean {
  try {
    return needsHomeScreen();
  } catch {
    return false;
  }
}
