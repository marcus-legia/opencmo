"use client";

/**
 * "Rate your first drafts" (cmo-review-3 2.2). The founder rates up to five versions of waiting posts (thumbs, a
 * reason on a thumbs down, a short note), the CMO turns the round into rules, and the sheet shows them ticked and
 * editable under "Your CMO learned:" with one button, "Use these rules". Rating is not deciding: the cards stay.
 *
 * Opened from Today's row (session B): `<RatingSheet open onClose={…} />`. Everything reads and writes through
 * `/api/v1/cmo/ratings` under the founder's session.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { Button, ButtonLink } from "@/components/ui";
import type { RatingSheet as Sheet } from "@/lib/cmo/voice";

import type { DraftReason } from "./labels";
import { ReasonChips } from "./ReasonChips";

type Rating = { verdict: "up" | "down" | null; reasonCode: DraftReason | null; note: string };
type Edit = { on: boolean; text: string };

const POLL_MS = 2_000;
/** A round's job runs within a minute; after this the sheet says it is still learning and stops asking. */
const POLL_LIMIT = 45;

const key = (d: { itemId: string; version: number }) => `${d.itemId}:${d.version}`;

export function RatingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const polls = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await api<Sheet>("/cmo/ratings");
      setSheet(next);
      setError(null);
      setEdits((was) => {
        const out = { ...was };
        for (const rule of next.latest?.rules ?? []) out[rule.id] ??= { on: true, text: rule.rule };
        return out;
      });
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The drafts could not be read. Try again.");
      return null;
    }
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setSaved(null);
      polls.current = 0;
      void load();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, load]);

  // While the round is being read, ask again every two seconds (a minute at most).
  useEffect(() => {
    if (!open || sheet?.latest?.state !== "learning" || polls.current >= POLL_LIMIT) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [open, sheet, load]);

  const rated = Object.entries(ratings).filter(([, r]) => r.verdict);

  async function send() {
    if (!sheet || busy || !rated.length) return;
    setBusy(true);
    try {
      await api("/cmo/ratings", jsonBody({
        ratings: sheet.drafts.flatMap((d) => {
          const r = ratings[key(d)];
          if (!r?.verdict) return [];
          return [{
            itemId: d.itemId,
            version: d.version,
            verdict: r.verdict,
            ...(r.verdict === "down" && r.reasonCode ? { reasonCode: r.reasonCode } : {}),
            ...(r.note.trim() ? { note: r.note.trim() } : {}),
          }];
        }),
      }));
      polls.current = 0;
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your ratings were not sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    const latest = sheet?.latest;
    if (!latest || busy) return;
    const ticked = latest.rules.filter((r) => edits[r.id]?.on).map((r) => ({ id: r.id, text: (edits[r.id]?.text ?? r.rule).trim() }));
    if (ticked.some((r) => r.text.length < 3 || r.text.length > 200)) return setError("Write each rule in 3 to 200 characters.");
    setBusy(true);
    try {
      const out = await api<{ accepted: number }>("/cmo/ratings/accept", jsonBody({ round: latest.round, rules: ticked }));
      setSaved(out.accepted);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The rules were not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, change: Partial<Rating>) =>
    setRatings((was) => ({ ...was, [k]: { ...(was[k] ?? { verdict: null, reasonCode: null, note: "" }), ...change } }));

  const latest = sheet?.latest ?? null;
  const ready = latest?.state === "ready" && latest.rules.length > 0;

  return (
    <dialog ref={ref} className="v2-dialog v2-rating-sheet" aria-labelledby="rating-sheet-title" data-testid="rating-sheet" onClose={onClose}>
      <div className="v2-dialog-body">
        <h2 id="rating-sheet-title" className="v2-dialog-title">
          {ready ? "Your CMO learned:" : "Rate your first drafts"}
        </h2>
        {error ? (
          <p className="v2-card-state is-failed" role="alert">
            <b>Not saved</b>
            <span>{error}</span>
          </p>
        ) : null}

        {saved !== null ? (
          <>
            <p>{saved === 0 ? "No rules kept. Your drafts stay as they are." : `${saved} ${saved === 1 ? "rule" : "rules"} saved. Every draft from now on follows ${saved === 1 ? "it" : "them"}.`}</p>
            <div className="v2-actions">
              <ButtonLink variant="secondary" compact href="/app/library?tab=voice">
                See your voice
              </ButtonLink>
              <Button variant="primary" compact onClick={() => ref.current?.close()}>
                Done
              </Button>
            </div>
          </>
        ) : ready ? (
          <>
            <p className="v2-muted">From your ratings. Untick a rule you do not want, or change its words.</p>
            <ul className="v2-rating-rules">
              {latest.rules.map((rule) => {
                const edit = edits[rule.id] ?? { on: true, text: rule.rule };
                return (
                  <li key={rule.id} data-testid="rating-rule">
                    <input
                      type="checkbox"
                      aria-label={`Use the rule: ${edit.text}`}
                      checked={edit.on}
                      disabled={busy}
                      onChange={(event) => setEdits((was) => ({ ...was, [rule.id]: { ...edit, on: event.target.checked } }))}
                    />
                    <input
                      className="v2-input is-compact"
                      aria-label="The rule's words"
                      value={edit.text}
                      maxLength={200}
                      disabled={busy || !edit.on}
                      onChange={(event) => setEdits((was) => ({ ...was, [rule.id]: { ...edit, text: event.target.value } }))}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="v2-actions">
              <Button variant="primary" compact disabled={busy} onClick={() => void accept()}>
                Use these rules
              </Button>
              <Button variant="quiet" compact onClick={() => ref.current?.close()}>
                Later
              </Button>
            </div>
          </>
        ) : latest?.state === "learning" ? (
          <p aria-live="polite">{polls.current >= POLL_LIMIT ? "Still reading your ratings. Come back in a minute." : "Your CMO is reading your ratings…"}</p>
        ) : !sheet ? (
          <p className="v2-muted" aria-busy="true">
            Loading your drafts…
          </p>
        ) : sheet.drafts.length === 0 ? (
          <>
            <p>
              {latest?.state === "failed"
                ? "Your CMO could not read your last ratings. You can rate again tomorrow."
                : latest?.state === "done" && latest.rules.length === 0 && sheet.ratedToday
                  ? "Nothing to change: your CMO keeps writing the way you liked."
                  : sheet.ratedToday
                    ? "You rated drafts today. Rate again tomorrow."
                    : "No drafts wait for you right now. They come with your next plan."}
            </p>
            <div className="v2-actions">
              <Button variant="primary" compact onClick={() => ref.current?.close()}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="v2-muted">Rating does not approve anything: the drafts stay in your queue. Your CMO turns your ratings into a few rules for you to check.</p>
            <ol className="v2-rating-list">
              {sheet.drafts.map((draft) => {
                const k = key(draft);
                const r = ratings[k] ?? { verdict: null, reasonCode: null, note: "" };
                return (
                  <li key={k} className="v2-rating" data-testid="rating-draft">
                    <p className="v2-rating-words">{draft.words}</p>
                    <div className="v2-actions" role="group" aria-label="Your rating">
                      <button type="button" className="v2-reason" aria-pressed={r.verdict === "up"} disabled={busy} onClick={() => set(k, { verdict: r.verdict === "up" ? null : "up", reasonCode: null })}>
                        👍 <span className="v2-visually-hidden">Good</span>
                      </button>
                      <button type="button" className="v2-reason" aria-pressed={r.verdict === "down"} disabled={busy} onClick={() => set(k, { verdict: r.verdict === "down" ? null : "down" })}>
                        👎 <span className="v2-visually-hidden">Not good</span>
                      </button>
                    </div>
                    {r.verdict === "down" ? <ReasonChips label="What is wrong with it? (optional)" value={r.reasonCode} onChange={(code) => set(k, { reasonCode: code })} disabled={busy} /> : null}
                    {r.verdict ? (
                      <label className="v2-field">
                        <span>A note for your CMO (optional)</span>
                        <input className="v2-input is-compact" value={r.note} maxLength={200} disabled={busy} onChange={(event) => set(k, { note: event.target.value })} />
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <div className="v2-actions">
              <Button variant="primary" compact disabled={busy || rated.length === 0} onClick={() => void send()}>
                {rated.length ? `Send ${rated.length} ${rated.length === 1 ? "rating" : "ratings"}` : "Rate a draft first"}
              </Button>
              <Button variant="quiet" compact onClick={() => ref.current?.close()}>
                Later
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
