"use client";

import { useCallback, useEffect, useState } from "react";

import { RatingSheet } from "@/components/cards/RatingSheet";
import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";

import { Button, SampleTag } from "@/components/ui";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import { VOICE_SOURCE_LABEL, type VoicePage } from "@/lib/cmo/voice";
import type { LibraryScreen as Data } from "@/lib/screens/library";

import { ErrorNote, Panel, SkeletonBlocks } from "../parts";
import type { ScreenState } from "../useScreen";

type Skill = Data["skills"]["writing"][number];

export function Gate({
  screen,
  children,
}: {
  screen: ScreenState<"library">;
  children: (data: Data, sample: { voice: boolean; skills: boolean }) => React.ReactNode;
}) {
  if (screen.status === "loading") return <SkeletonBlocks rows={2} />;
  if (screen.status === "error") return <ErrorNote>{screen.message}</ErrorNote>;
  return <>{children(screen.data, { voice: !screen.live.voice, skills: !screen.live.skills })}</>;
}

const noteDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/**
 * Voice notes Writer learned from the founder's decisions (P3 F5), heaviest first. Deleting one asks first; a live
 * note is deleted through `voice_note_delete` and never written again, a sample one only leaves this screen.
 */
export function VoiceTab({ voice, sample }: { voice: Data["voice"]; sample: { voice: boolean } }) {
  const { toast } = useShellState();
  const [notes, setNotes] = useState(voice.notes);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove(id: string) {
    setBusy(true);
    try {
      if (!sample.voice) await api(`/library/voice/${encodeURIComponent(id)}`, { method: "DELETE" });
      setNotes((all) => all.filter((n) => n.id !== id));
      setConfirming(null);
      toast(sample.voice ? "Note deleted (sample, nothing was sent)." : "Note deleted. Writer stops using it.");
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "The note could not be deleted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="library-voice"
      white
      title={<>Learned notes {sample.voice && <SampleTag />}</>}
      sub="Learned from your edits and skips; newer notes win when two disagree. Delete any you don't agree with."
    >
      <div className="scr-rows">
        {notes.length === 0 && <p className="scr-row scr-muted">No notes yet. Writer learns them from what you change in its drafts.</p>}
        {notes.map((note) => (
          <div key={note.id} className="scr-row scr-row-inline" data-testid="voice-note">
            <span>
              <b>{note.text}</b>
              <br />
              <span className="scr-tiny scr-muted">
                {note.platform ? PLATFORM_LABEL[note.platform] : "All platforms"} · {note.source} · {noteDate(note.at)}
                {note.replaces ? ` · replaces an older note “${note.replaces}”` : ""}
              </span>
              <span className="scr-voice-weight">
                <meter min={0} max={1} value={note.weight} aria-label={`Weight of “${note.text}”`} />
                <span className="scr-tiny scr-muted">weight {Math.round(note.weight * 100)}%</span>
              </span>
            </span>
            {confirming === note.id ? (
              <span className="scr-voice-confirm" role="group" aria-label={`Delete note: ${note.text}?`}>
                <span className="scr-tiny">Writer stops using it.</span>
                <Button compact variant="primary" disabled={busy} onClick={() => void remove(note.id)}>
                  Delete note
                </Button>
                <Button compact variant="quiet" disabled={busy} onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button compact variant="quiet" aria-label={`Delete note: ${note.text}`} onClick={() => setConfirming(note.id)}>
                Delete
              </Button>
            )}
          </div>
        ))}
        {voice.wordsCut.length > 0 && (
          <div className="scr-row">
            <b>Words you always cut</b>
            <span className="scr-cut-words">
              {voice.wordsCut.map((word) => (
                <s key={word}>{word}</s>
              ))}
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * The voice page (cmo-review-3 2.3), read live from `/api/v1/cmo/voice`: the rules every draft follows (edit or turn
 * off), the voice from setup, then (below the notes) the history with Undo. One reload after each change keeps the
 * three parts and the history in step. The founder edits rules, never the Writer's prompt.
 */
export function VoicePageView({ children }: { children: React.ReactNode }) {
  const [page, setPage] = useState<VoicePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setPage(await api<VoicePage>("/cmo/voice"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your voice could not be read. Try again.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!page) return <SkeletonBlocks rows={2} />;
  const changed = () => void load();
  return (
    <>
      <VoiceRules page={page} onChanged={changed} />
      {children}
      <VoiceHistory page={page} onChanged={changed} />
    </>
  );
}

function VoiceRules({ page, onChanged }: { page: VoicePage; onChanged: () => void }) {
  const { toast } = useShellState();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(false);

  async function change(id: string, change: { text?: string; on?: boolean }, done: string) {
    setBusy(true);
    try {
      await api(`/cmo/voice/rules/${encodeURIComponent(id)}`, { ...jsonBody(change), method: "PATCH" });
      setEditing(null);
      toast(done);
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "The rule was not changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        id="library-voice-rules"
        white
        title="Rules"
        sub="Every draft follows these. Edit the words or turn one off; the history below can undo it."
        actions={
          <Button compact variant="secondary" onClick={() => setRating(true)}>
            Rate your drafts
          </Button>
        }
      >
        <div className="scr-rows">
          {page.rules.length === 0 && <p className="scr-row scr-muted">No rules yet. Rate a few drafts, or approve a rule your CMO proposes from your edits.</p>}
          {page.rules.map((rule) =>
            editing?.id === rule.id ? (
              <form
                key={rule.id}
                className="scr-row v2-card-decline"
                onSubmit={(event) => {
                  event.preventDefault();
                  void change(rule.id, { text: editing.text.trim() }, "Rule saved. Every draft follows the new words.");
                }}
              >
                <label className="v2-field">
                  <span>The rule, in your words (up to 200 characters)</span>
                  <input className="v2-input" value={editing.text} minLength={3} maxLength={200} autoFocus onChange={(event) => setEditing({ id: rule.id, text: event.target.value })} />
                </label>
                <div className="v2-actions">
                  <Button type="submit" compact variant="primary" disabled={busy || editing.text.trim().length < 3}>
                    Save rule
                  </Button>
                  <Button compact variant="quiet" onClick={() => setEditing(null)}>
                    Keep it
                  </Button>
                </div>
              </form>
            ) : (
              <div key={rule.id} className="scr-row scr-row-inline" data-testid="voice-rule" data-on={rule.on || undefined}>
                <span>
                  <b className={rule.on ? undefined : "scr-muted"}>{rule.rule}</b>
                  <br />
                  <span className="scr-tiny scr-muted">
                    {VOICE_SOURCE_LABEL[rule.source]}
                    {rule.on ? "" : " · off"}
                  </span>
                </span>
                <span className="v2-actions">
                  {rule.on ? (
                    <Button compact variant="quiet" disabled={busy} aria-label={`Edit rule: ${rule.rule}`} onClick={() => setEditing({ id: rule.id, text: rule.rule })}>
                      Edit
                    </Button>
                  ) : null}
                  <Button
                    compact
                    variant="quiet"
                    disabled={busy}
                    aria-label={`${rule.on ? "Turn off" : "Turn on"} rule: ${rule.rule}`}
                    onClick={() => void change(rule.id, { on: !rule.on }, rule.on ? "Rule turned off. Drafts no longer follow it." : "Rule turned on. Every draft follows it.")}
                  >
                    {rule.on ? "Turn off" : "Turn on"}
                  </Button>
                </span>
              </div>
            ),
          )}
        </div>
      </Panel>
      <Panel id="library-voice-setup" white title="From your setup" sub="From your marketing strategy. Change it in the Business tab and every draft after uses it.">
        <div className="scr-rows">
          <div className="scr-row">
            <b>Voice</b>
            <span>{page.setup.voice ?? <span className="scr-muted">Not set yet.</span>}</span>
          </div>
          <div className="scr-row">
            <b>Words to avoid</b>
            <span>{page.setup.avoid.length ? page.setup.avoid.join(", ") : <span className="scr-muted">None yet.</span>}</span>
          </div>
          <div className="scr-row">
            <a href="/app/library?tab=business">Open the Business documents</a>
          </div>
        </div>
      </Panel>
      <RatingSheet
        open={rating}
        onClose={() => {
          setRating(false);
          onChanged();
        }}
      />
    </>
  );
}

const eventDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

function VoiceHistory({ page, onChanged }: { page: VoicePage; onChanged: () => void }) {
  const { toast } = useShellState();
  const [busy, setBusy] = useState(false);

  async function undo(eventId: string) {
    setBusy(true);
    try {
      await api("/cmo/voice/undo", jsonBody({ eventId }));
      toast("Undone. Your drafts follow what was there before.");
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Nothing was undone. Please try again.");
      // A newer change came in: show it, so the next Undo is the one the founder sees.
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="library-voice-history" white title="History" sub="Every change to what your drafts follow, newest first.">
      <div className="scr-rows">
        {page.history.length === 0 && <p className="scr-row scr-muted">No changes yet.</p>}
        {page.history.map((event) => (
          <div key={event.id} className="scr-row scr-row-inline" data-testid="voice-event" data-undone={event.undone || undefined}>
            <span>
              <span className={event.undone ? "scr-muted" : undefined}>{event.undone ? <s>{event.what}</s> : event.what}</span>
              <br />
              <span className="scr-tiny scr-muted">
                {VOICE_SOURCE_LABEL[event.source]} · {eventDate(event.at)}
                {event.undone ? " · undone" : ""}
              </span>
            </span>
            {event.canUndo ? (
              <Button compact variant="quiet" disabled={busy} onClick={() => void undo(event.id)}>
                Undo
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function SkillsTab({ skills, sample }: { skills: Data["skills"]; sample: { skills: boolean } }) {
  return (
    <>
      <SkillList id="library-writing-skills" title="Writing skills · used by Writer and Sales" items={skills.writing} sample={sample.skills} />
      <SkillList id="library-video-skills" title="Video skills · used by Studio and the editor" items={skills.video} sample={sample.skills} />
    </>
  );
}

/** Read only (P3 C1): what each skill is for and which agents read it. Skills change through their own files. */
function SkillList({ id, title, items, sample }: { id: string; title: string; items: Skill[]; sample: boolean }) {
  return (
    <Panel id={id} white title={<>{title} {sample && <SampleTag />}</>}>
      <div className="scr-rows">
        {items.length === 0 && <p className="scr-row scr-muted">None yet. Ask the editor Assistant to remember a recipe and it shows here.</p>}
        {items.map((item) => (
          <div key={item.id} className="scr-row">
            <b>{item.name}</b>
            <span className="scr-tiny scr-muted">
              {item.origin === "built_in" ? "Built in" : "Yours"} · {item.note}
            </span>
            <span className="scr-tiny">Read by {item.readBy.join(", ")}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
