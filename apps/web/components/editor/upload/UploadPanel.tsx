"use client";

/**
 * The editor's Upload tab: the user uploads their own video and edits it whole. Each upload
 * becomes one editable clip that opens at `/app/editor/<clip>`. There is no link import
 * (owner, 2026-10-20): a link plus a full download is the shape of a content downloader.
 *
 * Files never pass through Next.js: reserve a slot (`/uploads`), push it over TUS straight to
 * Storage, and only then create the job — the other way round the worker claims a job whose
 * file does not exist yet.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { UploadEdit } from "@/app/api/v1/editor/upload/route";
import { api, jsonBody } from "@/components/clipping/api";
import { stageLabel } from "@/components/clipping/ProcessingView";
import { useLive } from "@/components/clipping/useLive";
import { useShellAccount } from "@/components/clipping/web/WebShell";
import type { AspectRatio } from "@/lib/clipping-types";
import { CREDITS_PER_MINUTE, JOB_HOLD_CREDITS } from "@/lib/credits";
import { ASPECTS } from "@/lib/settings-schema";
import { formatBytes, MAX_EDIT_SECONDS, MAX_UPLOAD_BYTES, rejectReason, TOO_LONG } from "@/lib/upload";
import { uploadResumable, type UploadHandle } from "@/lib/upload-tus";

type Granted = { bucket: string; objectName: string; source: string | null };
// On/off only: the caption style is picked in the editor, from the editor's own presets.
type Captions = "on" | "off";

const CAPTIONS: { value: Captions; label: string }[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];
const TERMINAL = new Set(["done", "failed", "cancelled"]);

// Remembers the caption choice only; the frame follows the open edit every time.
const PREFS_KEY = "opencmo.upload.v1";
function readCaptions(): Captions | undefined {
  try {
    const data = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return data.captions === "off" ? "off" : data.captions === "on" ? "on" : undefined;
  } catch {
    return undefined;
  }
}

/** The file's length from its metadata in the browser — only to quote a price before the click. */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

export function UploadPanel({ frame, onOpen, hidden = false }: { frame: AspectRatio; onOpen: (clipId: string) => void; hidden?: boolean }) {
  const { credits, userId, refreshAccount } = useShellAccount();
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState<AspectRatio>(frame);
  const [captions, setCaptions] = useState<Captions>("on");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<UploadEdit[] | null>(null);
  const upload = useRef<UploadHandle | null>(null);
  const uploaded = useRef<{ file: File; source: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const prefsLoaded = useRef(false);
  // The file whose length is being read: a slower read of an earlier pick must not land on this one.
  const probing = useRef<File | null>(null);

  useLayoutEffect(() => {
    const saved = readCaptions();
    if (saved) setCaptions(saved);
    prefsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!prefsLoaded.current) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ captions }));
    } catch {
      // Storage blocked: back to the default next time.
    }
  }, [captions]);
  // The open edit's frame arrives after the first paint (once the renderer is up) and follows the FrameBar.
  useEffect(() => setAspect(frame), [frame]);
  // The panel stays mounted across tabs; leaving the editor stops a transfer nobody can see.
  useEffect(() => () => upload.current?.abort(), []);

  const load = useCallback(async () => {
    try {
      const { items } = await api<{ items: UploadEdit[] }>("/editor/upload");
      setJobs(items);
    } catch {
      setJobs((current) => current ?? []);
    }
  }, []);
  // The panel stays mounted behind the Media tab: it reads its list the first time it is shown.
  const shown = useRef(false);
  useEffect(() => {
    if (hidden || shown.current) return;
    shown.current = true;
    void load();
  }, [hidden, load]);
  const running = (jobs ?? []).some((job) => !TERMINAL.has(job.status));
  // Hidden, only an upload in flight keeps it listening, and it never polls.
  useLive("jobs", userId && `user_id=eq.${userId}`, () => void load(), Boolean(userId) && (!hidden || running || busy), running && !hidden, "editor-uploads");

  function pickFile(next: File | null) {
    if (busy) return;
    setError(null);
    uploaded.current = null;
    setDuration(null);
    const problem = next ? rejectReason(next.name, next.size) : null;
    if (problem) setError(problem);
    setFile(problem ? null : next);
    probing.current = problem ? null : next;
    if (!next || problem) return;
    void probeDuration(next).then((seconds) => {
      if (probing.current !== next) return;
      if (seconds !== null && seconds > MAX_EDIT_SECONDS) {
        setError(TOO_LONG);
        setFile(null);
        probing.current = null;
        return;
      }
      setDuration(seconds);
    });
  }

  async function sendFile(video: File): Promise<string> {
    const granted = await api<Granted>("/uploads", jsonBody({ name: video.name, size: video.size, kind: "source" }));
    setProgress(0);
    const handle = uploadResumable({
      bucket: granted.bucket,
      objectName: granted.objectName,
      file: video,
      onProgress: (fraction) => setProgress(Math.round(fraction * 100)),
    });
    upload.current = handle;
    await handle.promise;
    upload.current = null;
    if (!granted.source) throw new Error("Upload failed. Please try again.");
    return granted.source;
  }

  const needsPlan = credits !== null && credits < JOB_HOLD_CREDITS;
  const estimate = duration ? Math.max(1, Math.ceil(duration / 60)) * CREDITS_PER_MINUTE : null;
  const short = estimate !== null && credits !== null && estimate > credits;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !file) return;
    setBusy(true);
    setError(null);
    try {
      // A retry after a failed job start reuses the file already sent instead of uploading it again.
      const source = uploaded.current?.file === file ? uploaded.current.source : await sendFile(file);
      uploaded.current = { file, source };
      setProgress(null);
      await api("/editor/upload", jsonBody({ source, aspect, captions: captions === "on" }));
      uploaded.current = null;
      setFile(null);
      setDuration(null);
      refreshAccount();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start. Please try again.");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed2-clips" data-testid="upload-panel" hidden={hidden}>
      <form className="ed2-clips-form" onSubmit={submit} noValidate>
        <h3>Edit a video you made</h3>
        <p className="ed2-clips-hint">Your upload opens as its own edit, with a transcript you can cut by words.</p>
        <div
          className="ed2-clips-drop"
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            pickFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <strong>{file ? file.name : "Drop your video here"}</strong>
          {file ? <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small> : <small>Any video format · up to {formatBytes(MAX_UPLOAD_BYTES)} and {MAX_EDIT_SECONDS / 60} minutes</small>}
          <input
            ref={picker}
            type="file"
            accept="video/*"
            aria-label="Video file"
            data-testid="upload-file"
            hidden
            onChange={(event) => {
              pickFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <button type="button" className="ed2-btn" disabled={busy} onClick={() => picker.current?.click()}>
            {file ? "Choose another video" : "Choose video"}
          </button>
          {progress !== null ? (
            <div className="ed2-clips-progress">
              <progress max={100} value={progress} aria-label="Upload progress" />
              <button type="button" className="ed2-clips-switch" onClick={() => upload.current?.abort()}>Cancel</button>
            </div>
          ) : null}
        </div>

        <fieldset className="ed2-clips-seg" role="radiogroup" aria-label="Aspect ratio">
          <legend>Frame</legend>
          {ASPECTS.map((value) => (
            <label key={value} className={aspect === value ? "is-on" : ""}>
              <input type="radio" name="upload-aspect" value={value} checked={aspect === value} disabled={busy} onChange={() => setAspect(value)} />
              {value}
            </label>
          ))}
        </fieldset>
        <fieldset className="ed2-clips-seg" role="radiogroup" aria-label="Captions">
          <legend>Captions</legend>
          {CAPTIONS.map((option) => (
            <label key={option.value} className={captions === option.value ? "is-on" : ""}>
              <input type="radio" name="upload-captions" value={option.value} checked={captions === option.value} disabled={busy} onChange={() => setCaptions(option.value)} />
              {option.label}
            </label>
          ))}
        </fieldset>

        {error ? <p className="ed2-clips-error" role="alert">{error}</p> : null}
        {needsPlan ? (
          <a className="ed2-btn ed2-primary" href="/app/billing">Choose a plan to start</a>
        ) : (
          <button type="submit" className="ed2-btn ed2-primary" disabled={busy || !file} data-testid="upload-submit">
            {progress !== null ? `Uploading ${progress}%` : busy ? "Starting…" : "Upload and edit"}
          </button>
        )}
        <p className={`ed2-clips-hint ${short ? "is-short" : ""}`}>
          {estimate !== null ? `About ${estimate} ${estimate === 1 ? "credit" : "credits"}` : `${CREDITS_PER_MINUTE} credit per minute of video`}
          {credits !== null ? ` · ${credits} left` : ""}
          {short ? <> · <a href="/app/billing">Top up</a></> : null}
        </p>
      </form>

      <section className="ed2-clips-jobs" aria-label="Your uploads">
        {jobs === null ? <p className="ed2-clips-hint">Loading…</p> : null}
        {jobs?.length === 0 ? <p className="ed2-clips-hint">Videos you upload appear here.</p> : null}
        {jobs?.map((job) => (
          <article key={job.id} className="ed2-clips-job" data-testid="upload-job" data-job={job.id} data-status={job.status}>
            <header>
              <strong title={job.title ?? job.source_name}>{job.title ?? job.source_name}</strong>
            </header>
            {!TERMINAL.has(job.status) ? <small>{stageLabel(job)}</small> : null}
            {job.status === "failed" || job.status === "cancelled" ? <small className="ed2-clips-error">{job.error ?? stageLabel(job)}</small> : null}
            {job.status === "done" && job.clip_id ? (
              <ul>
                <li>
                  {job.thumbnail_url ? (
                    <video src={`${job.thumbnail_url}#t=0.1`} muted preload="metadata" aria-hidden="true" />
                  ) : (
                    <span className="ed2-clips-thumb" aria-hidden="true" />
                  )}
                  <span className="ed2-clips-hook">{job.duration ? `${Math.round(job.duration / 60) || 1} min` : "Ready"}</span>
                  <button type="button" className="ed2-btn" data-testid="upload-open" onClick={() => onOpen(job.clip_id!)}>
                    Open
                  </button>
                </li>
              </ul>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
