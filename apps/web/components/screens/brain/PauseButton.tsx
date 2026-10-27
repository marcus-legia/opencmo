"use client";

import { useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";

import { Button, ErrorNote } from "../kit";

/**
 * Pause CMO with a confirm step, or Resume when paused (`POST /api/v1/cmo/pause`, brain B2). Pausing asks first
 * because it stops scheduled posts; resuming does not, nothing is lost by it. On sample data the confirm
 * explains why it cannot be pressed.
 */
export function PauseButton({
  pausedAt,
  live,
  onChange,
  variant = "danger",
}: {
  pausedAt: string | null;
  /** False while the screen's `cmo` field is sample data. */
  live: boolean;
  onChange: (pausedAt: string | null) => void;
  variant?: "danger" | "on-dark";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(paused: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ pausedAt: string | null }>("/cmo/pause", jsonBody({ paused }));
      onChange(res.pausedAt);
      ref.current?.close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : paused ? "Could not pause. Please try again." : "Could not resume. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const cls = variant === "on-dark" ? "scr-pause-on-dark" : undefined;

  if (pausedAt) {
    return (
      <span className="scr-pause">
        <Button variant={variant === "on-dark" ? "secondary" : "dark"} className={cls} disabled={busy || !live} onClick={() => void set(false)}>
          {busy ? "Resuming…" : "Resume CMO"}
        </Button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </span>
    );
  }

  return (
    <>
      <Button variant={variant === "on-dark" ? "secondary" : "danger"} className={cls} onClick={() => ref.current?.showModal()}>
        Pause CMO
      </Button>
      <dialog ref={ref} className="scr-dialog" aria-labelledby="scr-pause-title">
        <div className="scr scr-dialog-body">
          <h2 id="scr-pause-title" className="scr-dialog-title">
            Pause your CMO?
          </h2>
          <p>
            Pause stops every order and every scheduled post within a minute. Nothing is deleted. Resume picks up where it
            stopped; posts whose time passed ask you again.
          </p>
          {!live && <p className="scr-small scr-muted">This page shows sample data, so there is nothing to pause yet.</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="scr-dialog-actions">
            <Button variant="danger" onClick={() => void set(true)} disabled={!live || busy}>
              {busy ? "Pausing…" : "Pause CMO"}
            </Button>
            <Button variant="quiet" onClick={() => ref.current?.close()}>
              Keep running
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
