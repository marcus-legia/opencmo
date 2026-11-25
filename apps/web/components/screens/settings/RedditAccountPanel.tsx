"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { Button } from "@/components/ui";
import type { AccountContext, ComposerContext } from "@/lib/composer/types";

import { Panel } from "../parts";

/**
 * Settings › Reddit account (Composer, plan Task C3): the username, karma and account age the Composer checks a post
 * against. Neither Reddit nor the APIs Ferreto reads give karma or account age, so the founder types them once from
 * their Reddit profile; the username finds their posts in a sub. Ferreto never signs in to Reddit.
 */
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function RedditAccountPanel() {
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [username, setUsername] = useState("");
  const [karma, setKarma] = useState("");
  const [month, setMonth] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    // The account rides on the context: X needs no Reddit call to answer it.
    api<ComposerContext>("/composer/context?platform=x")
      .then((ctx) => {
        if (!alive) return;
        setAccount(ctx.account);
        setUsername(ctx.account.username ?? "");
        setKarma(ctx.account.karma === null ? "" : String(ctx.account.karma));
        setMonth(ctx.account.accountCreatedAt ? ctx.account.accountCreatedAt.slice(0, 7) : "");
      })
      .catch(() => alive && setAccount({ username: null, karma: null, accountCreatedAt: null, postsInSub: 0, lastPostInSubAt: null }));
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    const u = username.trim().replace(/^\/?u\//i, "");
    const k = karma.trim().replace(/[,\s]/g, "");
    if (u && !USERNAME.test(u)) return setNote("A Reddit username is 3 to 20 letters, numbers, - or _.");
    if (k && !/^\d{1,8}$/.test(k)) return setNote("Karma is a whole number, as on your profile.");
    if (month && !MONTH.test(month)) return setNote("Pick the month the account was made.");
    setSaving(true);
    setNote(null);
    try {
      const saved = await api<AccountContext>(
        "/composer/account",
        jsonBody({ username: u || null, karma: k ? Number(k) : null, accountCreatedAt: month ? `${month}-01` : null }, "PUT"),
      );
      setAccount(saved);
      setUsername(saved.username ?? "");
      setNote("Saved.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel id="settings-reddit" title="Reddit account" sub="What the Composer checks a post against. Type it as on your Reddit profile; Ferreto never signs in to Reddit.">
      <form
        className="v2-panel-body scr-form"
        data-testid="settings-reddit"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="v2-field">
          <span>Username</span>
          <span className="scr-inline-field">
            <span className="scr-small">u/</span>
            <input className="v2-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_username" maxLength={24} disabled={account === null} data-testid="settings-reddit-username" />
          </span>
        </label>
        <label className="v2-field">
          <span>Karma</span>
          <input className="v2-input" inputMode="numeric" value={karma} onChange={(e) => setKarma(e.target.value)} placeholder="Optional" maxLength={12} disabled={account === null} data-testid="settings-reddit-karma" />
        </label>
        <label className="v2-field">
          <span>Account made in</span>
          <input className="v2-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} max={new Date().toISOString().slice(0, 7)} disabled={account === null} data-testid="settings-reddit-month" />
        </label>
        <span className="scr-inline-field" style={{ flexWrap: "wrap" }}>
          <Button compact variant="secondary" type="submit" disabled={account === null || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Link className="scr-small" href="/app/compose">
            Open the Composer
          </Link>
          {note ? (
            <span role="status" className="scr-small">
              {note}
            </span>
          ) : null}
        </span>
      </form>
    </Panel>
  );
}
