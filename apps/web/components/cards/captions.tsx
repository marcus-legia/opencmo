"use client";

/**
 * Captions on a finished video or shorts card (P3 F8): one per platform profile, with the profile's limits
 * (`packages/contracts/platforms.json`) counted as the founder types. Saving sends `edit_caption` with the card's
 * hash; the card keeps its id and gets a new hash.
 */

import { useState } from "react";

import { Button } from "@/components/ui";
import { countHashtags, profileOf } from "@/lib/cmo/platforms";
import type { Caption } from "@/lib/screens/approval-card";

export type SaveCaption = (caption: Caption) => Promise<boolean>;

/** Characters as SQL's `char_length` counts them (code points), so the counter and the server agree. */
export const charCount = (text: string) => Array.from(text).length;

export function CaptionList({ captions, idBase, heading, editable, onSave }: { captions: Caption[]; idBase: string; heading: string; editable: string | null; onSave: SaveCaption }) {
  if (captions.length === 0) return null;
  return (
    <section className="v2-card-captions" aria-label={heading}>
      <p className="v2-card-captions-head">{heading}</p>
      <ul>
        {captions.map((caption) => (
          <CaptionItem key={caption.id} caption={caption} idBase={`${idBase}-${caption.id}`} editable={editable} onSave={onSave} />
        ))}
      </ul>
    </section>
  );
}

/** `editable`: null when the founder may edit, else why not (shown as the button's title). */
function CaptionItem({ caption, idBase, editable, onSave }: { caption: Caption; idBase: string; editable: string | null; onSave: SaveCaption }) {
  const profile = profileOf(caption.profile);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(caption.text);
  const [title, setTitle] = useState(caption.title ?? "");
  if (!profile) return null;

  const shown = editing ? text : caption.text;
  const length = charCount(shown);
  const tags = countHashtags(shown);
  const titleLength = charCount(editing ? title : (caption.title ?? ""));
  const tooLong = length > profile.limit;
  const tooManyTags = tags > profile.hashtags;
  const titleWrong = profile.title !== null && (titleLength === 0 || titleLength > profile.title);
  const empty = text.trim().length === 0;
  const changed = text !== caption.text || (profile.title !== null && title !== (caption.title ?? ""));

  async function save() {
    if (busy || !changed || empty || tooLong || tooManyTags || titleWrong) return;
    setBusy(true);
    const ok = await onSave({ ...caption, text: text.trim(), title: profile!.title !== null ? title.trim() : null });
    setBusy(false);
    if (ok) setEditing(false);
  }

  return (
    <li className="v2-card-caption" data-testid="caption" data-profile={caption.profile}>
      <div className="v2-card-caption-head">
        <b>{profile.label}</b>
        <span className="v2-card-chips">
          <span className={`v2-chip ${tooLong ? "is-stuck" : "is-posted"}`} aria-label={`${length} of ${profile.limit} characters`}>
            {length}/{profile.limit}
          </span>
          <span className={`v2-chip ${tooManyTags ? "is-stuck" : "is-idle"}`} aria-label={`${tags} of at most ${profile.hashtags} hashtags`}>
            #{tags}/{profile.hashtags}
          </span>
        </span>
      </div>
      {editing ? (
        <form
          className="v2-card-caption-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {profile.title !== null ? (
            <label className="v2-field" htmlFor={`${idBase}-title`}>
              <span>
                Title ({titleLength}/{profile.title})
              </span>
              <input id={`${idBase}-title`} className="v2-input is-compact" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          ) : null}
          <label className="v2-field" htmlFor={`${idBase}-text`}>
            <span>{profile.kind === "youtube" ? "Description" : "Caption"}</span>
            <textarea id={`${idBase}-text`} className="v2-input" value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          {tooManyTags ? <p className="v2-card-caption-warn">At most {profile.hashtags} hashtags here.</p> : null}
          {tooLong ? <p className="v2-card-caption-warn">At most {profile.limit} characters here.</p> : null}
          {titleWrong && editing ? <p className="v2-card-caption-warn">The title needs 1 to {profile.title} characters.</p> : null}
          <div className="v2-actions">
            <Button type="submit" variant="primary" compact disabled={busy || !changed || empty || tooLong || tooManyTags || titleWrong}>
              Save caption
            </Button>
            <Button
              variant="quiet"
              compact
              disabled={busy}
              onClick={() => {
                setText(caption.text);
                setTitle(caption.title ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {caption.title ? <p className="v2-card-strong">{caption.title}</p> : null}
          <p className="v2-card-text">{caption.text}</p>
          <div>
            <Button
              variant="secondary"
              compact
              disabled={!!editable}
              title={editable ?? undefined}
              aria-label={`Edit ${profile.label}`}
              onClick={() => {
                setText(caption.text);
                setTitle(caption.title ?? "");
                setEditing(true);
              }}
            >
              Edit
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
