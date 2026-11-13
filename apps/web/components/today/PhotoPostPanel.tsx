"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { Button } from "@/components/ui";
import { PHOTO_LIMIT, PHOTO_MAX_BYTES, PHOTO_PLATFORMS, PHOTO_TYPES, photoPostProblem, type PhotoPlatform, type PhotoPost } from "@/lib/photo-posts";
import { uploadPhoto } from "@/lib/photo-upload-client";

import { useSignedPhotos } from "@/components/cards/post-photos";

import { PlatformLogo } from "./platform-logos";

const LABEL: Record<PhotoPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", threads: "Threads" };
/** SQL `cmo_job_price('photo_caption')`: held before the caption is written. */
const CAPTION_CREDITS = 1;

type Photo = { key: string; name: string; object: string | null; progress: number; failed: string | null };

/**
 * A photo post (daily core drafts D7, owner 2026-11-12): the founder's own photos as a TikTok photo post or an Instagram
 * or Threads carousel. Photos go from the browser straight to Storage (TUS, with a reservation); the founder orders
 * them, writes the caption or asks the CMO for one, picks platforms, and each platform gets a schedule card.
 */
export function PhotoPostPanel({ connectedPlatforms, live, onScheduled }: { connectedPlatforms: readonly string[]; live: boolean; onScheduled?: () => void }) {
  const [open, setOpen] = useState(false);
  const [postId, setPostId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [platforms, setPlatforms] = useState<PhotoPlatform[]>([]);
  const [busy, setBusy] = useState<null | "starting" | "caption" | "schedule">(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);


  const connected = (p: PhotoPlatform) => connectedPlatforms.includes(p);
  const urls = useSignedPhotos(photos.flatMap((p) => (p.object ? [p.object] : [])));
  const ready = photos.filter((p) => p.object);
  const uploading = photos.some((p) => !p.object && !p.failed);
  const problem = photoPostProblem(ready.length, platforms, caption);

  const fail = (error: unknown, fallback: string) => setNote({ ok: false, text: error instanceof ApiError ? error.message : fallback });

  async function start() {
    setOpen(true);
    setNote(null);
    if (!live || postId) return;
    setBusy("starting");
    try {
      setPostId((await api<{ id: string }>("/photo-posts", jsonBody({}))).id);
    } catch (error) {
      fail(error, "Could not start a photo post. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setNote(null);
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const bad = !(PHOTO_TYPES as readonly string[]).includes(file.type)
        ? "Use a JPEG, PNG or WebP photo."
        : file.size > PHOTO_MAX_BYTES
          ? "This photo is over 10 MB."
          : null;
      setPhotos((now) => [...now, { key, name: file.name, object: null, progress: 0, failed: bad ?? (live ? null : "Sample: nothing is uploaded.") }]);
      if (!bad && live && postId) void upload(key, file, postId);
    }
    if (input.current) input.current.value = "";
  }

  async function upload(key: string, file: File, id: string) {
    const patch = (p: Partial<Photo>) => setPhotos((now) => now.map((x) => (x.key === key ? { ...x, ...p } : x)));
    try {
      const object = await uploadPhoto(`/photo-posts/${encodeURIComponent(id)}/uploads`, file, (f) => patch({ progress: f }));
      patch({ object, progress: 1 });
    } catch (error) {
      patch({ failed: error instanceof Error ? error.message : "The upload stopped. Remove it and add it again." });
    }
  }

  const move = (index: number, by: -1 | 1) =>
    setPhotos((now) => {
      const next = [...now];
      const to = index + by;
      if (to < 0 || to >= next.length) return now;
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });
  const remove = (key: string) => setPhotos((now) => now.filter((p) => p.key !== key));
  const toggle = (p: PhotoPlatform) => setPlatforms((now) => (now.includes(p) ? now.filter((x) => x !== p) : [...now, p]));

  /** Saves the set as it is on screen; SQL checks every photo is the founder's upload and each platform's count. */
  async function save(): Promise<boolean> {
    if (!postId) return false;
    try {
      await api<PhotoPost>(`/photo-posts/${encodeURIComponent(postId)}`, jsonBody({ photos: ready.map((p) => p.object!), caption, platforms }, "PATCH"));
      return true;
    } catch (error) {
      fail(error, "Could not save the photo post.");
      return false;
    }
  }

  async function writeCaption() {
    if (!live) return setNote({ ok: true, text: "Sample: no caption was written and nothing was charged." });
    if (!postId || busy) return;
    setBusy("caption");
    setNote(null);
    try {
      if (!(await save())) return;
      const before = caption;
      await api(`/photo-posts/${encodeURIComponent(postId)}/caption`, jsonBody({ notes }));
      // The caption is written right after the answer; read the post again until it lands (about half a minute).
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const post = await api<PhotoPost>(`/photo-posts/${encodeURIComponent(postId)}`);
        if (post.caption && post.caption !== before) {
          setCaption(post.caption);
          setNote({ ok: true, text: "Caption written. Edit it as you like before you schedule." });
          return;
        }
      }
      setNote({ ok: false, text: "The caption is taking longer than usual. It shows here when it is ready; reopen the photo post in a minute." });
    } catch (error) {
      fail(error, "Could not write the caption. Your credit came back.");
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    if (!live) return setNote({ ok: true, text: "Sample: nothing was scheduled." });
    if (!postId || busy || problem || uploading) return;
    setBusy("schedule");
    setNote(null);
    try {
      if (!(await save())) return;
      const { slots } = await api<{ slots: number }>(`/photo-posts/${encodeURIComponent(postId)}/schedule`, jsonBody({}));
      setNote({ ok: true, text: `${slots === 1 ? "A schedule card is" : `${slots} schedule cards are`} waiting on your Feed: check the time and approve ${slots === 1 ? "it" : "each"}.` });
      setPostId(null);
      setPhotos([]);
      setCaption("");
      setNotes("");
      setPlatforms([]);
      onScheduled?.();
    } catch (error) {
      fail(error, "Could not schedule the photo post.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Photo post" data-testid="photo-post" className="photo-post">
      <div className="photo-post-head">
        <span className="photo-post-icon" aria-hidden="true">
          <svg className="i" viewBox="0 0 24 24">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
          </svg>
        </span>
        <div className="photo-post-title">
          <h2>Photo post</h2>
          <p>Post your own photos as a swipeable set: a TikTok photo post, an Instagram carousel or a Threads post.</p>
        </div>
        {open ? null : (
          <Button compact variant="secondary" onClick={() => void start()} disabled={busy === "starting"}>
            New photo post
          </Button>
        )}
      </div>
      {open ? (
        <div className="photo-post-body">
          <StepHead n={1} title="Add your photos" hint="They post in this order. Use the arrows to move one." />
          <div className="photo-post-grid" aria-label="Photos, in posting order">
            {photos.map((p, i) => (
              <figure key={p.key} className={p.failed ? "is-stuck" : undefined}>
                {/* The thumbnail is the uploaded photo's signed link, never a link made from the picked file. */}
                {p.object && urls[p.object] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed link to the founder's own photo
                  <img src={urls[p.object]} alt={`Photo ${i + 1}: ${p.name}`} />
                ) : (
                  <span className="photo-post-wait">{p.failed ? p.name : `Uploading ${p.name}`}</span>
                )}
                <figcaption>
                  <span>{i + 1}</span>
                  {p.failed ? <span className="photo-post-fail">{p.failed}</span> : p.object ? null : <span>{Math.round(p.progress * 100)}%</span>}
                  <span className="photo-post-tools">
                    <button type="button" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ←
                    </button>
                    <button type="button" aria-label={`Move photo ${i + 1} later`} disabled={i === photos.length - 1} onClick={() => move(i, 1)}>
                      →
                    </button>
                    <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(p.key)}>
                      ×
                    </button>
                  </span>
                </figcaption>
              </figure>
            ))}
            <label className="photo-post-add">
              <input ref={input} type="file" accept={PHOTO_TYPES.join(",")} multiple onChange={(e) => addFiles(e.target.files)} disabled={live && !postId} />
              <span>Add photos</span>
              <span className="meta">JPEG, PNG or WebP, 10 MB each</span>
            </label>
          </div>

          <StepHead n={2} title="Where it posts" hint="Each one you pick gets its own time to approve." />
          <fieldset className="photo-post-platforms">
            <legend className="v2-visually-hidden">Post it on</legend>
            {PHOTO_PLATFORMS.map((p) => (
              <label key={p} data-on={platforms.includes(p) || undefined}>
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} />
                <PlatformLogo platform={p} size={32} />
                <span className="photo-post-where">
                  <b>{LABEL[p]}</b>
                  <span className="meta">
                    Up to {PHOTO_LIMIT[p]} photos
                    {connected(p) ? null : (
                      <>
                        {" · "}
                        <Link href="/app/settings#settings-connected-accounts">Connect first</Link>
                      </>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <StepHead n={3} title="Write the caption" hint="Type it yourself, or say what the photos show and let your CMO write it." />
          <label className="v2-field">
            <span>What do the photos show?</span>
            <textarea className="v2-input" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="v2-actions">
            <Button compact variant="quiet" disabled={busy !== null || notes.trim().length < 3} onClick={() => void writeCaption()}>
              {busy === "caption" ? "Writing the caption…" : `Write the caption · ${CAPTION_CREDITS} credit`}
            </Button>
          </div>
          <label className="v2-field">
            <span>Caption</span>
            <textarea className="v2-input" rows={5} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>

          <div className="v2-actions">
            <Button variant="primary" disabled={busy !== null || uploading || problem !== null} onClick={() => void schedule()}>
              {busy === "schedule" ? "Scheduling…" : "Schedule"}
            </Button>
            <span className="meta">{uploading ? "Uploading your photos…" : problem ?? `${ready.length} photos, ${platforms.map((p) => LABEL[p]).join(", ")}`}</span>
          </div>
        </div>
      ) : null}
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={note.ok ? "meta" : "photo-post-fail"}>
          {note.text}
        </p>
      ) : null}
    </section>
  );
}

/** One numbered step of the panel: a founder who has never made a carousel reads 1, 2, 3. */
function StepHead({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="photo-step">
      <span aria-hidden="true">{n}</span>
      <div>
        <h3>{title}</h3>
        <p>{hint}</p>
      </div>
    </div>
  );
}
