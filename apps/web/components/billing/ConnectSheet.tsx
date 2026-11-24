"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Right after a plan is bought (`/app?paid=1&connect=1`, owner 2026-11-24): connect the accounts you post from, so an
 * approved post can go out at its time. Without one, the week's posts are copy and post yourself. Shown once: closing
 * it or going to Settings drops the flag, and an account already connected skips it. It never says the plan is active:
 * `connect=1` is a URL anyone can type, and Creem's webhook may not have landed yet.
 */
export function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void createClient()
      .from("social_accounts")
      .select("id")
      .eq("status", "connected")
      .limit(1)
      .then(({ data, error }) => {
        // A read that fails still shows the sheet: asking once too often beats a founder who never connects.
        if (live) setConnected(!error && Boolean(data?.length));
      });
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (open && connected) onClose();
  }, [open, connected, onClose]);

  const show = open && connected === false;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (show && !dialog.open) dialog.showModal();
    if (!show && dialog.open) dialog.close();
  }, [show]);

  if (!show) return null;
  return (
    <dialog
      ref={ref}
      className="v2-dialog plan-sheet up-sheet"
      aria-labelledby="connect-sheet-title"
      data-testid="connect-sheet"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="up-sheet-top">
        <div>
          <h2 id="connect-sheet-title">Connect the accounts you post from</h2>
          <p>With an account connected, a post you approve goes out at its time from your own account. Until then, you copy each post and post it yourself.</p>
        </div>
        <button type="button" className="up-sheet-close" aria-label="Close" onClick={() => ref.current?.close()}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end", padding: "4px 0 0" }}>
        <button type="button" className="skip" onClick={() => ref.current?.close()}>
          Later
        </button>
        {/* Drops `connect` first, so Back from Settings does not ask again. */}
        <Link className="primary up-cta" href="/app/settings#settings-connected-accounts" data-testid="connect-sheet-go" onClick={onClose}>
          Connect accounts →
        </Link>
      </div>
    </dialog>
  );
}
