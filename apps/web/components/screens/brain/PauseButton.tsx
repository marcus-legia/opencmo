"use client";

import { useRef, useState } from "react";

import { Button, ErrorNote } from "../kit";

/**
 * Pause CMO with a confirm step. The pause RPC arrives with brain B2 (Session A); until a page
 * passes `onPause`, the confirm explains that and cannot be pressed.
 */
export function PauseButton({ onPause, variant = "danger" }: { onPause?: () => Promise<void>; variant?: "danger" | "on-dark" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!onPause) return;
    setBusy(true);
    setError(null);
    try {
      await onPause();
      ref.current?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pause. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant={variant === "on-dark" ? "secondary" : "danger"}
        className={variant === "on-dark" ? "scr-pause-on-dark" : undefined}
        onClick={() => ref.current?.showModal()}
      >
        Pause CMO
      </Button>
      <dialog ref={ref} className="scr-dialog" aria-labelledby="scr-pause-title">
        <div className="scr scr-dialog-body">
          <h2 id="scr-pause-title" className="scr-dialog-title">Pause your CMO?</h2>
          <p>
            Pause stops every order and every scheduled post within a minute. Nothing is deleted. Resume picks up where it
            stopped; posts whose time passed ask you again.
          </p>
          {!onPause && <p className="scr-small scr-muted">Pausing is not available in this preview yet.</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="scr-dialog-actions">
            <Button variant="danger" onClick={() => void confirm()} disabled={!onPause || busy}>
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
