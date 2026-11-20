"use client";

import { useState } from "react";

import { ApiError, WEB_BASE, api, jsonBody } from "@/components/clipping/api";
import type { QuoteCardChoices } from "@/lib/cmo/library";
import { uploadPhoto } from "@/lib/photo-upload-client";

/**
 * "Make a quote card" (wave 4b C7): pick a quote from the post's Library sources, see the card on the brand look, add
 * it as one of the post's photos. Removing it is removing the photo. No AI, no credit.
 */
export function QuoteCardMaker({
  itemId,
  onAdd,
  onError,
  disabled,
}: {
  itemId: string;
  /** Uploads went through; saves the photo list with `object` added and answers once the card carries it. */
  onAdd: (object: string) => Promise<void>;
  onError: (message: string) => void;
  disabled: boolean;
}) {
  const [choices, setChoices] = useState<QuoteCardChoices | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/cmo/items/${encodeURIComponent(itemId)}/quote-card`;

  async function open() {
    setBusy("Reading your Library…");
    try {
      setChoices(await api<QuoteCardChoices>(base));
      setPick(0);
    } catch (error) {
      onError(error instanceof ApiError ? error.message : "Could not read the quotes. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const chosen = choices?.quotes[pick] ?? null;
  const preview = chosen ? `${WEB_BASE}${base}?entry=${encodeURIComponent(chosen.entryId)}&quote=${encodeURIComponent(chosen.text)}` : null;

  async function add() {
    if (!chosen || !preview) return;
    setBusy("Making the card…");
    try {
      const response = await fetch(preview, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not make the card. Try again.");
      const file = new File([await response.blob()], "quote-card.png", { type: "image/png" });
      setBusy("Uploading…");
      const object = await uploadPhoto(`/cmo/items/${encodeURIComponent(itemId)}/photos/uploads`, file);
      setBusy("Saving…");
      await onAdd(object);
      await api(base, jsonBody({ entryId: chosen.entryId, quote: chosen.text, object }));
      setChoices(null);
    } catch (error) {
      onError(error instanceof ApiError || error instanceof Error ? error.message : "Could not add the card. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!choices) {
    return (
      <button type="button" className="v2-card-photo-add" data-testid="quote-card-make" disabled={disabled || busy !== null} onClick={() => void open()}>
        <span>{busy ?? "Make a quote card"}</span>
        <span className="v2-card-photo-hint">A quote from the conversations this post draws on, on your brand colours.</span>
      </button>
    );
  }

  return (
    <div className="v2-quote-card" data-testid="quote-card">
      {choices.quotes.length === 0 ? (
        <p className="v2-card-photo-hint">This post has no quotes to use. Posts written from your Library have them.</p>
      ) : (
        <>
          <fieldset>
            <legend>Pick a quote</legend>
            {choices.quotes.map((q, i) => (
              <label key={`${q.entryId}-${i}`}>
                <input type="radio" name={`quote-${itemId}`} checked={pick === i} onChange={() => setPick(i)} />
                <span>
                  {"“"}
                  {q.text}
                  {"”"} <span className="v2-card-photo-hint">{q.community}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- the card as it will go out, rendered by the server
            <img src={preview} alt="The quote card" width={216} height={270} />
          ) : null}
          <p className="v2-card-photo-hint">The quote and where it was said. No name, no link.</p>
        </>
      )}
      <span className="v2-quote-card-actions">
        <button type="button" className="ghost" disabled={busy !== null} onClick={() => setChoices(null)}>
          Cancel
        </button>
        {choices.quotes.length ? (
          <button type="button" className="primary" data-testid="quote-card-add" disabled={busy !== null || !chosen} onClick={() => void add()}>
            {busy ?? "Add to the post"}
          </button>
        ) : null}
      </span>
    </div>
  );
}
