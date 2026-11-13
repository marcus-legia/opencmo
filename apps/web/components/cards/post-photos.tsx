"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import type { ApprovalCard } from "@/lib/screens/approval-card";
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from "@/lib/photo-posts";
import { createClient } from "@/lib/supabase/client";
import { uploadResumable } from "@/lib/upload-tus";

/** `post_photos_save` holds the same number: X takes 4, and one core post serves every platform of its slot. */
export const POST_PHOTO_LIMIT = 4;

/** Short-lived links to the founder's own photos; the `photos` bucket lets a founder read only their own folder. */
function useSignedPhotos(objects: readonly string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = objects.join("\n");
  useEffect(() => {
    if (!objects.length) return;
    let live = true;
    void createClient()
      .storage.from("photos")
      .createSignedUrls([...objects], 3600)
      .then(({ data }) => {
        if (!live || !data) return;
        setUrls(Object.fromEntries(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : []))));
      });
    return () => {
      live = false;
    };
    // `key` stands for the list: a new array with the same photos must not sign them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/** The photos that go out with a post, in order, read-only (schedule cards, a decided post). */
export function PhotoStrip({ photos, label }: { photos: readonly string[]; label: string }) {
  const urls = useSignedPhotos(photos);
  if (!photos.length) return null;
  return (
    <ol className="v2-card-photos" aria-label={label} data-testid="card-photos">
      {photos.map((object, i) => (
        <li key={object}>
          {urls[object] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed link to the founder's own photo
            <img src={urls[object]} alt={`Photo ${i + 1}`} />
          ) : (
            <span className="v2-card-photo-wait">Photo {i + 1}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The founder's own photos on a text post (owner, 2026-11-13): add up to four, remove one. Each upload goes from the
 * browser to Storage with a reservation; the list is saved in order and answers the card that now carries them.
 */
export function PostPhotos({
  itemId,
  photos,
  sample,
  onCard,
  onError,
}: {
  itemId: string;
  photos: readonly string[];
  sample: boolean;
  /** The post card as it now waits, with the photos in its hash; null once approved (its schedule cards ask again). */
  onCard: (card: ApprovalCard | null) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const room = POST_PHOTO_LIMIT - photos.length;

  async function save(next: string[]) {
    const answer = await api<{ card: ApprovalCard | null }>(`/cmo/items/${encodeURIComponent(itemId)}/photos`, jsonBody({ photos: next }, "PUT"));
    onCard(answer.card);
  }

  async function add(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (input.current) input.current.value = "";
    if (!picked.length) return;
    if (sample) return onError("Sample card: nothing was uploaded.");
    if (picked.length > room) return onError(`A post takes up to ${POST_PHOTO_LIMIT} photos.`);
    const bad = picked.find((f) => !(PHOTO_TYPES as readonly string[]).includes(f.type) || f.size > PHOTO_MAX_BYTES);
    if (bad) return onError("Use JPEG, PNG or WebP photos of 10 MB at most.");
    const added: string[] = [];
    try {
      for (const [i, file] of picked.entries()) {
        setBusy(`Uploading ${i + 1} of ${picked.length}…`);
        const reserved = await api<{ bucket: string; objectName: string }>(
          `/cmo/items/${encodeURIComponent(itemId)}/photos/uploads`,
          jsonBody({ size: file.size, type: file.type }),
        );
        await uploadResumable({ bucket: reserved.bucket, objectName: reserved.objectName, file, contentType: file.type }).promise;
        added.push(reserved.objectName);
      }
      setBusy("Saving…");
      await save([...photos, ...added]);
    } catch (error) {
      onError(error instanceof ApiError || error instanceof Error ? error.message : "The upload stopped. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(object: string) {
    if (sample) return onError("Sample card: nothing was changed.");
    setBusy("Saving…");
    try {
      await save(photos.filter((p) => p !== object));
    } catch (error) {
      onError(error instanceof ApiError ? error.message : "Could not remove the photo. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const urls = useSignedPhotos(photos);
  return (
    <div className="v2-card-photo-edit" data-testid="post-photos">
      {photos.length ? (
        <ol className="v2-card-photos" aria-label="Your photos, in posting order">
          {photos.map((object, i) => (
            <li key={object}>
              {urls[object] ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed link to the founder's own photo
                <img src={urls[object]} alt={`Photo ${i + 1}`} />
              ) : (
                <span className="v2-card-photo-wait">Photo {i + 1}</span>
              )}
              <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={busy !== null} onClick={() => void remove(object)}>
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {room > 0 ? (
        <label className={`v2-card-photo-add${busy ? " is-busy" : ""}`}>
          <input ref={input} type="file" accept={PHOTO_TYPES.join(",")} multiple disabled={busy !== null} onChange={(e) => void add(e.target.files)} />
          <span>{busy ?? (photos.length ? "Add more photos" : "Add photos")}</span>
          <span className="v2-card-photo-hint">Your own, up to {POST_PHOTO_LIMIT}: they go out with the post on every platform.</span>
        </label>
      ) : busy ? (
        <span className="v2-card-photo-hint">{busy}</span>
      ) : null}
    </div>
  );
}
