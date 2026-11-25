"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { api, jsonBody } from "@/components/clipping/api";
import { PlatformBadge } from "@/components/today/platform-logos";
import type { AccountContext, ComposerContext } from "@/lib/composer/types";

const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

/**
 * The founder's public Reddit karma and account month, read by their own browser (owner, 2026-11-25: "only the
 * username, the rest is too much"). The server cannot read Reddit; a browser usually can. Null when Reddit does not
 * answer this way: the Composer then checks the account from its posts alone.
 */
export async function readRedditProfile(username: string): Promise<{ karma: number | null; month: string | null } | null> {
  try {
    const res = await fetch(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, { credentials: "omit", cache: "no-store" });
    if (!res.ok) return null;
    const data = ((await res.json()) as { data?: { total_karma?: unknown; link_karma?: unknown; comment_karma?: unknown; created_utc?: unknown } }).data;
    if (!data) return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    const karma = num(data.total_karma) ?? (num(data.link_karma) !== null || num(data.comment_karma) !== null ? (num(data.link_karma) ?? 0) + (num(data.comment_karma) ?? 0) : null);
    const created = num(data.created_utc);
    return { karma, month: created ? new Date(created * 1000).toISOString().slice(0, 7) : null };
  } catch {
    return null;
  }
}

const monthLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Reddit as a row of Connected accounts (owner, 2026-11-25): the username only. Ferreto never signs in to Reddit and
 * never posts there; the Composer checks a post against the sub's rules and this account.
 */
export function RedditAccountRow() {
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api<ComposerContext>("/composer/context?platform=x")
      .then((ctx) => {
        if (!alive) return;
        setAccount(ctx.account);
        setUsername(ctx.account.username ?? "");
      })
      // A failed read keeps the field off: saving over it would erase what is stored.
      .catch((err: unknown) => alive && setLoadError(err instanceof Error ? err.message : "Could not read your Reddit account. Reload to try again."));
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    const u = username.trim().replace(/^\/?u\//i, "");
    if (u && !USERNAME.test(u)) return setNote("A Reddit username is 3 to 20 letters, numbers, - or _.");
    setSaving(true);
    setNote(null);
    try {
      const profile = u ? await readRedditProfile(u) : null;
      // The stored numbers belong to the stored username: another name, or none, never inherits them (review 2026-11-25).
      const same = u !== "" && u === account?.username;
      const saved = await api<AccountContext>(
        "/composer/account",
        jsonBody({
          username: u,
          karma: u ? (profile?.karma ?? (same ? account!.karma : null)) : null,
          accountCreatedAt: u ? (profile?.month ?? (same ? (account!.accountCreatedAt?.slice(0, 7) ?? null) : null)) : null,
        }, "PUT"),
      );
      setAccount(saved);
      setUsername(saved.username ?? "");
      setNote(u ? (profile ? "Saved." : "Saved. Reddit did not share your karma here; the Composer checks your posts instead.") : "Removed.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const known = [account?.karma != null ? `${account.karma.toLocaleString("en-US")} karma` : null, account?.accountCreatedAt ? `since ${monthLabel(account.accountCreatedAt)}` : null].filter(Boolean).join(" · ");
  const changed = username.trim().replace(/^\/?u\//i, "") !== (account?.username ?? "");
  return (
    <div className="scr-account scr-account-reddit" data-testid="settings-reddit" data-platform="reddit">
      <span className="scr-account-who">
        <PlatformBadge platform="reddit" size={30} />
        <span>
          <b>Reddit</b>
          {account?.username && known ? <span className="scr-small scr-muted"> · {known}</span> : null}
          <span className="scr-small scr-muted scr-account-note">You post on Reddit yourself. Ferreto checks your post against the sub&apos;s rules and your account.</span>
          {loadError ? <span className="scr-status is-stuck scr-account-note" role="alert">{loadError}</span> : null}
          {note ? <span className="scr-small scr-account-note" role="status">{note}</span> : null}
        </span>
      </span>
      <form
        className="scr-reddit-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="scr-reddit-input">
          <span aria-hidden="true">u/</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_username" maxLength={24} aria-label="Your Reddit username" disabled={account === null} data-testid="settings-reddit-username" />
        </label>
        {/* Unchanged, it reads karma and age again: a first read Reddit refused can be tried again. */}
        <Button compact variant="secondary" type="submit" disabled={account === null || saving || (!changed && !username.trim())}>
          {saving ? "Saving…" : changed || !account?.username ? "Save" : "Refresh"}
        </Button>
      </form>
    </div>
  );
}
