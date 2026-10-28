"use client";

import { useEffect, useRef } from "react";

import { ChatPanel, type ChatSource } from "@/components/cmo/workspace/ChatPanel";
import { Button } from "@/components/ui";

/**
 * "Ask your CMO": today's CMO chat (the same sessions as the classic workspace) in a sheet over the Dashboard.
 * `?ask=1` opens it, so the Brain page's link lands in the conversation.
 */
export function AskSheet({ open, chatLive, onClose, onWorkStarted, onToast }: {
  open: boolean;
  /** False when no chat model is configured: the panel then says so itself. */
  chatLive: boolean;
  onClose: () => void;
  onWorkStarted: () => void;
  onToast: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const source: ChatSource = { live: { chat: chatLive }, chat: [], chatTitle: null, demo: false };

  return (
    <dialog ref={dialog} className="v2-ask" aria-label="Ask your CMO" onClose={onClose} onClick={(event) => event.target === dialog.current && onClose()}>
      <div className="v2-ask-body">
        <div className="v2-ask-head">
          <span className="v2-mono is-small is-muted">Ask your CMO</span>
          <Button variant="quiet" compact onClick={onClose}>
            Close
          </Button>
        </div>
        {/* Mounted only while open: the chat loads its session when it appears, not with the Dashboard. */}
        {open ? <ChatPanel ws={source} onToast={onToast} onWorkStarted={onWorkStarted} /> : null}
      </div>
    </dialog>
  );
}
