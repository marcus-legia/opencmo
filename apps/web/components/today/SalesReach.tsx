"use client";

import { useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { emailBody, emailSubject, mailLinks } from "@/lib/cmo/email-links";
import { PERSON_STATUSES, type PersonStatus, type ReachCheck } from "@/lib/cmo/reach";
import { PLATFORM_LABEL, type SalesPlatform } from "@/lib/cmo/social/conversations";
import type { SalesScreen } from "@/lib/screens/sales";

type Thread = SalesScreen["threads"][number];
export type Person = NonNullable<Thread["person"]>;

export const STATUS_LABEL: Record<PersonStatus, string> = {
  found: "Found",
  replied: "Replied",
  answered_back: "Answered back",
  talking: "Talking",
  signed_up: "Signed up",
  customer: "Customer",
  not_interested: "Not interested",
};

const LEVEL_LABEL = { reply_first: "Reply first", dm_ready: "DM ready", email_ready: "Email ready" } as const;

/** Where the platform's private messages open: the founder sends the DM there, from their own account. */
const CHAT_URL: Partial<Record<SalesPlatform, string>> = {
  reddit: "https://www.reddit.com/chat",
  facebook: "https://www.facebook.com/messages",
  threads: "https://www.threads.com/",
};

/**
 * The five checks of "Ready to reach out", each with its line from the scan (`reasons`, in the same order as
 * `sales-scan.ts` writes them). Read from the post and its thread only, never a profile.
 */
const CHECK_LABELS = ["A buyer like your customers", "Wants it now", "Warm", "Fresh", "A way to reach them"] as const;

function checksOf(reach: ReachCheck | null): { label: string; ok: boolean | null; why: string }[] {
  // Found before the checks existed (or a check that did not parse): the five checks show as not checked yet.
  if (!reach) return CHECK_LABELS.map((label) => ({ label, ok: null, why: "Not checked yet" }));
  const r = reach.reasons;
  const way = reach.dmAllowed || reach.emailFound !== null;
  return [
    { label: "A buyer like your customers", ok: reach.buyer, why: r[0] ?? "" },
    { label: "Wants it now", ok: reach.wantsNow, why: r[1] ?? "" },
    { label: "Warm", ok: reach.warm, why: r[2] ?? "" },
    { label: "Fresh", ok: reach.fresh, why: r[3] ?? "" },
    { label: "A way to reach them", ok: way, why: [r[4], r[5]].filter(Boolean).join(" · ") },
  ];
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Tab = "public" | "dm" | "email";

/**
 * A tab that is not open yet still shows what it is for (owner, 2026-11-20): why it is closed, what opens it, and
 * where the draft will be, dimmed. Nothing in it can be copied or sent.
 */
function LockedTab({ kind, why, opens, testId }: { kind: "dm" | "email"; why: string; opens: string; testId: string }) {
  return (
    <div className="reach-locked" role="note" data-testid={testId}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <b>{kind === "dm" ? "DM not open yet" : "Email not open yet"}</b>
      </div>
      <p className="meta" style={{ margin: "0" }}>{why}</p>
      <p className="meta" style={{ margin: "0" }}>
        <span style={{ fontWeight: "500", color: "var(--text)" }}>Opens when </span>
        {opens}
      </p>
      <div className="reach-locked-draft" aria-hidden="true">
        {kind === "dm" ? "One short message, written from their post. You send it from your own account." : "To: the address they published · Subject: about their post · One email, with a line to say no."}
      </div>
    </div>
  );
}

/** Read by a screen reader, not shown. */
const SR: React.CSSProperties = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/**
 * Ready to reach out (wave 3, canvas board ReachOut): the level, the five checks with their reasons, and the three ways
 * to reach the person. The public reply is the thread's own draft (passed in as `publicReply`); a DM and an email are
 * open only when the checks allow them, and a locked tab says why. "I sent it" marks the person replied, which moves
 * them to Following up. Nothing is sent from here.
 */
export function ReachPanel({ t, publicReply, onSent }: { t: Thread; publicReply: React.ReactNode; onSent: (via: "dm" | "email") => Promise<void> }) {
  const person = t.person;
  const [tab, setTab] = useState<Tab>("public");
  const [dm, setDm] = useState(person?.dmDraft ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!person) return <>{publicReply}</>;
  const reach = person.reach;
  const level = person.reachLevel;
  const hasDms = t.platform !== "hn";
  const dmLock = !hasDms
    ? `${PLATFORM_LABEL[t.platform]} has no private messages. Reply in public.`
    : level === "reply_first"
      ? "Reply in public first: they have not answered you yet, and their post does not ask for tools."
      : !person.dmDraft
        ? "No DM drafted for this person yet."
        : null;
  const subject = emailSubject(t.title);
  const links = reach?.emailFound ? mailLinks(reach.emailFound, subject, dm) : { gmail: null, mailto: null };
  const emailLock = level !== "email_ready" || !reach?.emailFound ? (reach?.emailFound ? "They have not answered you yet." : "No address they published themselves was found.") : null;

  async function sent(via: "dm" | "email") {
    setBusy(true);
    try {
      await onSent(via);
    } finally {
      setBusy(false);
    }
  }

  const tabs: [Tab, string, string | null][] = [
    ["public", "Public reply", null],
    ["dm", "DM", dmLock],
    ["email", "Email", emailLock],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} data-testid="sales-reach">
      {(
        <section aria-label="Ready to reach out" className="card" data-testid="sales-reach-card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <b>Ready to reach out</b>
            <span className="chip" data-testid="sales-reach-level">
              {LEVEL_LABEL[level]}
            </span>
            <span className="meta">From their post and thread only</span>
          </div>
          {!reach ? (
            <p className="meta" data-testid="sales-reach-unchecked" style={{ margin: "0" }}>
              Found before Ferreto checked who is ready for a DM or an email. Your next scan checks the people it finds.
            </p>
          ) : null}
          <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
            {checksOf(reach).map((c) => (
              <li key={c.label} data-testid="sales-reach-check" data-ok={c.ok} style={{ display: "flex", gap: "8px", fontSize: "13.5px" }}>
                <span aria-hidden="true" style={{ width: "14px", color: c.ok ? "var(--ok)" : "var(--subtle)" }}>
                  {c.ok ? "✓" : "–"}
                </span>
                {/* The reason goes under the check when the row is narrow (a phone), not beside it one word a line. */}
                <span style={{ display: "flex", flexWrap: "wrap", gap: "0 8px", minWidth: "0", flex: "1 1 auto" }}>
                  <span style={{ fontWeight: "500", whiteSpace: "nowrap" }}>{c.label}</span>
                  <span className="meta" style={{ minWidth: "0" }}>
                    <span style={SR}>{c.ok === null ? "not checked" : c.ok ? "yes" : "no"}: </span>
                    {c.why}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div role="tablist" aria-label="How to reach them" className="reach-tabs" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {tabs.map(([id, label, lock]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setNote(null);
            }}
            className="pill"
            style={tab === id ? { color: "var(--text)", borderColor: "var(--text)" } : undefined}
          >
            {label}
            {lock ? <span style={SR}> (locked)</span> : null}
          </button>
        ))}
      </div>

      {tab === "public" ? publicReply : null}

      {tab === "dm" ? (
        dmLock ? (
          <LockedTab
            kind="dm"
            testId="sales-dm-locked"
            why={dmLock}
            opens={hasDms ? "they answer your public reply, or their post asks for tools. Ferreto drafts the DM then." : "never on this platform: reply in public."}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} data-testid="sales-dm">
            <label className="meta" htmlFor={`dm-${t.id}`}>
              One message, no sequence. Check the community allows DMs before you send it.
            </label>
            <textarea id={`dm-${t.id}`} className="reply" rows={4} value={dm} onChange={(e) => setDm(e.target.value)} style={{ width: "100%", resize: "vertical", font: "inherit", fontSize: "15px", lineHeight: "1.55", color: "var(--text)" }} />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              {note ? <span className="meta">{note}</span> : null}
              <button type="button" className="ghost" disabled={busy} onClick={() => void sent("dm")}>
                I sent it
              </button>
              <button
                type="button"
                className="primary"
                disabled={!dm.trim()}
                onClick={async () => {
                  setNote((await copy(dm)) ? "Copied. Paste it in the chat." : "Select the message and copy it.");
                  window.open(CHAT_URL[t.platform] ?? t.url, "_blank", "noopener,noreferrer");
                }}
              >
                Copy and open {PLATFORM_LABEL[t.platform]} chat
              </button>
            </div>
          </div>
        )
      ) : null}

      {tab === "email" ? (
        emailLock ? (
          <LockedTab
            kind="email"
            testId="sales-email-locked"
            why={emailLock}
            opens="they published an email address themselves (in the post, the thread or their own site) and answered you."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} data-testid="sales-email">
            <div style={{ fontSize: "13.5px" }}>
              <span className="meta">To </span>
              {reach!.emailFound}
            </div>
            <p className="meta" style={{ margin: "0" }}>
              An address they published themselves. Send it from your own mailbox, once. Ferreto adds a last line so they can tell you no.
            </p>
            <div style={{ fontSize: "13.5px" }}>
              <span className="meta">Subject </span>
              {subject}
            </div>
            <textarea aria-label="Email" className="reply" rows={5} value={dm} onChange={(e) => setDm(e.target.value)} style={{ width: "100%", resize: "vertical", font: "inherit", fontSize: "15px", lineHeight: "1.55", color: "var(--text)" }} />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              {note ? <span className="meta">{note}</span> : null}
              {dm.trim() && !links.gmail ? <span className="meta" data-testid="sales-email-long">Too long for a link. Copy it into your mail.</span> : null}
              <button type="button" className="ghost" disabled={busy} onClick={() => void sent("email")}>
                I sent it
              </button>
              <button type="button" className="ghost" onClick={async () => setNote((await copy(reach!.emailFound!)) ? "Address copied." : "Select the address and copy it.")}>
                Copy address
              </button>
              <button type="button" className="ghost" disabled={!dm.trim()} onClick={async () => setNote((await copy(emailBody(dm))) ? "Email copied." : "Select the email and copy it.")}>
                Copy
              </button>
              {links.mailto ? (
                <a className="ghost" data-testid="sales-email-mailto" href={links.mailto} style={{ textDecoration: "none" }}>
                  Open in your mail app
                </a>
              ) : null}
              {links.gmail ? (
                <a className="primary" data-testid="sales-email-gmail" href={links.gmail} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                  Open in Gmail
                </a>
              ) : null}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

/**
 * "I replied" asks where (canvas board Replied): the link to the reply lets Ferreto read the thread again for an
 * answer. Skippable; the person is in Following up either way.
 */
export function ReplyLink({ t, live, onDone }: { t: Thread; live: boolean; onDone: (url: string | null) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (live) await api(`/sales/people/${encodeURIComponent(t.id)}`, jsonBody({ action: "reply_link", url: url.trim() }));
      onDone(url.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the link.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="card"
      data-testid="sales-reply-link"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) void save();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "8px" }}
    >
      <b>Nice. Where did you post it?</b>
      <span className="meta">Paste the link to your reply and Ferreto checks the thread for an answer, so you know who to follow up with. You can skip this.</span>
      <label className="meta" htmlFor={`reply-url-${t.id}`}>
        Link to your reply
      </label>
      <input id={`reply-url-${t.id}`} type="url" inputMode="url" placeholder={t.url} value={url} onChange={(e) => setUrl(e.target.value)} style={{ height: "34px", padding: "0 10px", border: "1px solid var(--line-2)", borderRadius: "7px", background: "var(--bg)", color: "var(--text)", font: "inherit" }} />
      {error ? (
        <span role="alert" className="meta" style={{ color: "var(--warn)" }}>
          {error}
        </span>
      ) : null}
      <span style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={() => onDone(null)}>
          Skip
        </button>
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? "Saving…" : "Save and follow up"}
        </button>
      </span>
    </form>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return "";
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  return d === 0 ? "today" : d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : `${Math.round(d / 7)} ${Math.round(d / 7) === 1 ? "week" : "weeks"} ago`;
};

/** What a row in Following up says under its title, from the person's status and what Ferreto can read. */
function detailOf(t: Thread, p: Person): string {
  if (p.status === "answered_back") return "They answered your reply. Read it and reply back.";
  if (p.status === "replied" && p.nudgeDraft) return "No answer yet. A short nudge is drafted, if you want to send one.";
  if (p.status === "replied" && (t.platform === "facebook" || t.platform === "threads") && !p.replyUrl) return "Ferreto cannot read this thread again on its own. Mark it yourself.";
  if (p.status === "replied") return p.replyUrl ? "No answer yet. Ferreto reads the thread again for one." : "No answer yet. Add the link to your reply so Ferreto can check it.";
  if (p.status === "signed_up") return "Marked as signed up.";
  if (p.status === "customer") return "Marked as a customer.";
  if (p.status === "talking") return "You are talking.";
  return "";
}

/**
 * Following up (wave 3, canvas board FollowingUp): the people the founder replied to, the ones who answered on top,
 * each with what to do next, the nudge when one is drafted, and a select to mark where they stand.
 */
export function FollowingUp({ threads, live, onStatus }: { threads: Thread[]; live: boolean; onStatus: (id: string, status: PersonStatus) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const order: PersonStatus[] = ["answered_back", "talking", "replied", "signed_up", "customer"];
  const people = threads
    .filter((t) => t.status === "replied" && t.person && t.person.status !== "not_interested" && t.person.status !== "found")
    .sort((a, b) => order.indexOf(a.person!.status) - order.indexOf(b.person!.status) || Date.parse(b.person!.statusAt ?? "0") - Date.parse(a.person!.statusAt ?? "0"));

  async function mark(t: Thread, status: PersonStatus) {
    setError(null);
    try {
      if (live) await api(`/sales/people/${encodeURIComponent(t.id)}`, jsonBody({ action: "status", status }));
      onStatus(t.id, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    }
  }

  return (
    <section aria-label="Following up" data-testid="sales-following" style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <p className="meta" style={{ margin: "0" }}>
        People you replied to. Ferreto reads Reddit and Hacker News threads again after a few days and puts the ones who answered on top.
      </p>
      {error ? (
        <p role="alert" className="meta" style={{ color: "var(--warn)", margin: "0" }}>
          {error}
        </p>
      ) : null}
      {people.length === 0 ? <div className="meta">No one yet. When you reply to someone, they show here.</div> : null}
      {people.map((t) => {
        const p = t.person!;
        const answered = p.status === "answered_back";
        return (
          <div key={t.id} className="card" data-testid="sales-person" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span className="meta">
                {[PLATFORM_LABEL[t.platform], t.community !== PLATFORM_LABEL[t.platform] ? t.community : null, p.repliedAt ? `you replied ${ago(p.repliedAt)}` : null].filter(Boolean).join(" · ")}
              </span>
              <span className="chip" data-testid="sales-person-status" style={answered ? { color: "var(--ok)" } : undefined}>
                {p.status === "replied" ? "No answer yet" : STATUS_LABEL[p.status]}
              </span>
            </div>
            <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: "500", color: "inherit" }}>
              {t.title}
            </a>
            <span className="meta">{detailOf(t, p)}</span>
            {open === t.id && p.nudgeDraft ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }} data-testid="sales-nudge">
                <p className="quote" style={{ margin: "0" }}>
                  {p.nudgeDraft}
                </p>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
              <label className="meta" htmlFor={`status-${t.id}`}>
                Mark
              </label>
              <select id={`status-${t.id}`} className="pill" style={{ height: "32px" }} value={p.status} onChange={(e) => void mark(t, e.target.value as PersonStatus)}>
                {PERSON_STATUSES.filter((s) => s !== "found").map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              {p.nudgeDraft && open !== t.id ? (
                <button type="button" className="ghost" onClick={() => setOpen(t.id)}>
                  Read the nudge
                </button>
              ) : null}
              {p.nudgeDraft && open === t.id ? (
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    if (await copy(p.nudgeDraft!)) setCopied(t.id);
                    window.open(p.replyUrl ?? t.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  {copied === t.id ? "Copied · thread opened" : "Copy and open thread"}
                </button>
              ) : (
                <a href={p.replyUrl ?? t.url} target="_blank" rel="noopener noreferrer" className="ghost" style={{ textDecoration: "none" }}>
                  {answered ? "Read and reply" : "Open thread"}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
