"use client";

/**
 * The drawer on the right when an Inbox card is clicked: every detail needed to decide.
 *
 * Each kind has exactly its own buttons (san-pham.md §3.3):
 * - X post: Approve · Edit · Skip, three versions, a 280-character count;
 * - Reddit thread: Open thread · Copy reply · I replied · Dismiss — NO post button.
 */

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import type { InboxCard, PostCard, SalesCard } from "@/lib/cmo/workspace";

import { xIntent, type Actions } from "./actions";
import { AgentMark } from "./AgentMark";
import { ago, when } from "./time";

type Props = { card: InboxCard | null; agentName: string; onClose: () => void; actions: Actions };

export function CardDrawer({ card, agentName, onClose, actions }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (card && !dialog.open) dialog.showModal();
    if (!card && dialog.open) dialog.close();
  }, [card]);

  // Quyết định xong (thành công) thì đóng ngăn kéo; lỗi thì giữ lại để người dùng sửa.
  const act: Actions["card"] = async (c, a) => {
    const ok = await actions.card(c, a);
    if (ok) onClose();
    return ok;
  };

  return (
    <dialog ref={ref} className="cmo-drawer" aria-labelledby="cmo-drawer-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {card ? (
        <div className="cmo-drawer-inner" data-testid={`cmo-card-${card.department}`}>
          <header className="cmo-drawer-head">
            <AgentMark department={card.department} size={28} />
            <div>
              <p className="cmo-feed-agent">{agentName} · <time dateTime={card.createdAt} suppressHydrationWarning>{ago(card.createdAt)}</time></p>
              <h2 id="cmo-drawer-title">{card.title}</h2>
            </div>
            <button type="button" className="cmo-icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </header>
          {card.department === "post" ? <PostDetail key={card.id} card={card} act={act} /> : null}
          {card.department === "sales" ? <SalesDetail key={card.id} card={card} act={act} onToast={actions.toast} /> : null}
        </div>
      ) : null}
    </dialog>
  );
}

function PostDetail({ card, act }: { card: PostCard; act: Actions["card"] }) {
  const versions = card.finalText ? [card.finalText] : [card.text, ...card.alternates];
  const approved = card.state === "approved";
  const [busy, setBusy] = useState(false);
  const run = async (a: Parameters<Actions["card"]>[1]) => {
    setBusy(true);
    await act(card, a);
    setBusy(false);
  };
  const [pick, setPick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.text);
  const current = editing ? text : versions[pick];
  return (
    <>
      <div className="cmo-x-preview">
        <span className="cmo-x-avatar" aria-hidden>You</span>
        <div>
          <p className="cmo-x-name">Your X account</p>
          {editing ? (
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} aria-label="Post text" />
          ) : (
            <p className="cmo-x-text">{current}</p>
          )}
          <p className={`cmo-x-count ${current.length > 280 ? "is-over" : ""}`}>{current.length}/280</p>
        </div>
      </div>
      {versions.length > 1 && !editing && !approved ? (
        <div className="cmo-versions" role="group" aria-label="Versions">
          {versions.map((_, i) => (
            <button key={i} type="button" aria-pressed={pick === i} onClick={() => setPick(i)}>Version {i + 1}</button>
          ))}
        </div>
      ) : null}
      <p className="cmo-why"><b>Why:</b> {card.rationale}</p>
      {approved ? (
        <>
          <p className="cmo-why"><b>Approved.</b> Post on X opens the post ready to send from your own account. Come back and mark it posted.</p>
          <div className="cmo-card-actions">
            <a className="primary-button" href={xIntent(current)} target="_blank" rel="noopener noreferrer">
              Post on X <Icon name="external-link" size={14} />
            </a>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void run({ type: "posted" })}>I posted it</button>
          </div>
        </>
      ) : (
        <>
          {card.scheduledFor ? <p className="cmo-why" suppressHydrationWarning><b>Goes out:</b> {when(card.scheduledFor)}, on your account, after you approve.</p> : null}
          <div className="cmo-card-actions">
            <button type="button" className="primary-button" disabled={busy || current.length > 280} onClick={() => void run({ type: "approve", text: current })}>
              Approve
            </button>
            {editing ? (
              <button type="button" className="secondary-button" onClick={() => setEditing(false)}>Done</button>
            ) : (
              <button type="button" className="secondary-button" onClick={() => { setText(versions[pick]); setEditing(true); }}>Edit</button>
            )}
            <button type="button" className="text-button" disabled={busy} onClick={() => void run({ type: "skip" })}>Skip</button>
          </div>
        </>
      )}
    </>
  );
}

function SalesDetail({ card, act, onToast }: { card: SalesCard; act: Actions["card"]; onToast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const run = async (a: Parameters<Actions["card"]>[1]) => {
    setBusy(true);
    await act(card, a);
    setBusy(false);
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(card.reply);
      onToast("Reply copied. Paste it in the thread from your own account");
    } catch {
      onToast("Could not copy. Select the reply and copy it");
    }
  }
  return (
    <>
      <div className="cmo-thread">
        <p className="cmo-thread-meta" suppressHydrationWarning>{[card.thread.community, card.thread.author, card.thread.postedAt ? ago(card.thread.postedAt) : null, `${card.thread.comments} comments`].filter(Boolean).join(" · ")}</p>
        <p className="cmo-thread-title">{card.thread.title}</p>
        <p className="cmo-thread-snippet">{card.thread.snippet}</p>
      </div>
      <button type="button" className="cmo-score" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="cmo-score-num">{card.score}</span>
        <span className="cmo-score-label">Worth joining<small>{open ? "Hide why" : "See why"}</small></span>
      </button>
      {open ? (
        <ul className="cmo-parts">
          {card.parts.map((p) => (
            <li key={p.label}>
              <span className="cmo-part-label">{p.label}</span>
              <span className="cmo-part-bar" aria-hidden><span style={{ width: `${(p.score / p.max) * 100}%` }} /></span>
              <span className="cmo-part-score">{p.score}/{p.max}</span>
              <span className="cmo-part-ev">{p.evidence}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="cmo-reply">
        <p className="cmo-reply-label">Drafted reply · you post it</p>
        <p>{card.reply}</p>
      </div>
      <p className="cmo-why">Open the thread, read it, and paste the reply from your own Reddit account if it fits. Then mark it replied.</p>
      {dismissing ? (
        <form
          className="cmo-skip"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ type: "dismiss", reason: reason.trim() || undefined });
          }}
        >
          <label htmlFor={`dismiss-${card.id}`}>Why dismiss it? <small>Optional. Your CMO learns from it.</small></label>
          <input id={`dismiss-${card.id}`} value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} placeholder="Not our customer, wrong subreddit, too old…" />
          <div className="cmo-feed-actions">
            <button type="button" className="text-button" onClick={() => setDismissing(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy}>Dismiss</button>
          </div>
        </form>
      ) : (
        <div className="cmo-card-actions">
          <a className="primary-button" href={card.thread.url} target="_blank" rel="noopener noreferrer">
            Open thread <Icon name="external-link" size={14} />
          </a>
          <button type="button" className="secondary-button" onClick={copy}>Copy reply</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void run({ type: "replied" })}>I replied</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => setDismissing(true)}>Dismiss</button>
        </div>
      )}
    </>
  );
}
