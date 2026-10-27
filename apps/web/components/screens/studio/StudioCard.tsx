"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Chip, LinkButton, cx } from "../kit";
import type { Card } from "./model";

export type CardActions = {
  open: (card: Card) => void;
  openInEditor: (card: Card) => void;
  toggleFavorite: (card: Card) => void;
  rename: (card: Card, title: string) => void;
  retry: (card: Card) => void;
  cancel: (card: Card) => void;
  remove: (card: Card) => void;
};

/** Generated media: a picture of its kind until real thumbnails exist (the frame's drawings). */
function KindArt({ card }: { card: Card }) {
  if (card.kind === "short") {
    return (
      <span className="scr-art is-shorts" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (card.kind === "slideshow") {
    return (
      <span className="scr-art is-slides" aria-hidden="true">
        <b>{card.title}</b>
      </span>
    );
  }
  if (card.kind === "post_image") return <span className="scr-art is-image" aria-hidden="true" />;
  return <span className="scr-art is-video" aria-hidden="true" />;
}

function Thumb({ card }: { card: Card }) {
  const video = useRef<HTMLVideoElement>(null);
  if (card.status === "failed") {
    return (
      <div className="scr-thumb is-failed">
        <span className="scr-mono is-small">{card.project ? "Processing failed" : "Render failed"}</span>
      </div>
    );
  }
  if (card.status === "uploading" || card.status === "processing") {
    return (
      <div className="scr-thumb is-pending">
        <span className="scr-mono is-small">
          {card.status === "uploading" ? `Uploading${card.progress != null ? ` · ${Math.round(card.progress)}%` : ""}` : "Processing"}
        </span>
        {card.progress != null && (
          <span className="scr-progress" role="progressbar" aria-valuenow={Math.round(card.progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
            <i style={{ width: `${card.progress}%` }} />
          </span>
        )}
      </div>
    );
  }
  return (
    <div
      className={cx("scr-thumb", card.status === "finished" && "has-tag")}
      onMouseEnter={() => void video.current?.play().catch(() => undefined)}
      onMouseLeave={() => video.current?.pause()}
    >
      {card.thumbnailUrl ? (
        <video ref={video} src={`${card.thumbnailUrl}#t=0.1`} muted loop playsInline preload="metadata" aria-hidden="true" />
      ) : (
        <KindArt card={card} />
      )}
      {card.status === "finished" && (
        <span className="scr-thumb-tag">
          <Chip tone="posted">Finished</Chip>
        </span>
      )}
      {card.status === "running" && card.progress != null && (
        <span className="scr-thumb-bar" aria-hidden="true">
          <i style={{ width: `${card.progress}%` }} />
        </span>
      )}
    </div>
  );
}

export function StudioCard({ card, busy, actions }: { card: Card; busy: boolean; actions: CardActions }) {
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const upload = !!card.project;

  // Delete is two taps on the same item; the second tap must come within 3 s (same as the old page).
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) {
        setMenu(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const tone =
    card.status === "failed" ? "is-failed" : card.status === "waiting_founder" ? "is-waiting" : card.status === "running" ? "is-running" : card.status === "uploading" ? "is-uploading" : "";

  return (
    <article className={cx("scr-card", tone)} data-item={card.id}>
      <Thumb card={card} />
      {upload && (
        <div className="scr-card-tools" ref={menuRef}>
          <button
            type="button"
            className="scr-round"
            aria-pressed={card.favorite}
            aria-label={card.favorite ? `Remove ${card.title} from favorites` : `Add ${card.title} to favorites`}
            disabled={busy}
            onClick={() => actions.toggleFavorite(card)}
          >
            <span aria-hidden="true">{card.favorite ? "★" : "☆"}</span>
          </button>
          <button
            type="button"
            className="scr-round"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`More for ${card.title}`}
            onClick={() => {
              setMenu((open) => !open);
              setConfirming(false);
            }}
          >
            <span aria-hidden="true">···</span>
          </button>
          {menu && (
            <div role="menu" className="scr-menu">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setRenaming(card.title); }}>
                Rename
              </button>
              {(card.status === "failed" || card.status === "cancelled") && (
                <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(false); actions.retry(card); }}>
                  Process again
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => { setMenu(false); actions.open(card); }}>
                Details
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={busy}
                data-confirming={confirming || undefined}
                onClick={() => {
                  if (!confirming) {
                    setConfirming(true);
                    return;
                  }
                  setConfirming(false);
                  setMenu(false);
                  actions.remove(card);
                }}
              >
                {confirming ? "Delete? Tap again" : "Delete"}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="scr-card-body">
        {renaming !== null ? (
          <form
            className="scr-rename"
            onSubmit={(event) => {
              event.preventDefault();
              if (!renaming.trim()) return;
              actions.rename(card, renaming.trim());
              setRenaming(null);
            }}
          >
            <input aria-label="Title" className="scr-input" value={renaming} maxLength={120} autoFocus onChange={(e) => setRenaming(e.target.value)} />
            <span className="scr-dialog-actions">
              <Button small variant="dark" type="submit" disabled={!renaming.trim() || busy}>
                Save
              </Button>
              <Button small variant="quiet" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </span>
          </form>
        ) : (
          <a
            href={`?item=${encodeURIComponent(card.id)}`}
            className="scr-card-title"
            onClick={(event) => {
              event.preventDefault();
              actions.open(card);
            }}
          >
            {card.title}
          </a>
        )}
        <span className="scr-small scr-muted">{card.failure ?? card.subtitle}</span>
        <CardState card={card} busy={busy} actions={actions} />
      </div>
    </article>
  );
}

function CardState({ card, busy, actions }: { card: Card; busy: boolean; actions: CardActions }) {
  switch (card.status) {
    case "uploading":
      return null;
    case "processing":
      return card.project ? (
        <Button small variant="ghost" disabled={busy} onClick={() => actions.cancel(card)}>
          Cancel
        </Button>
      ) : null;
    case "running":
      return (
        <span>
          <Chip tone="running">Running</Chip>
        </span>
      );
    case "waiting_founder":
      return card.approvalId ? (
        <a href={`/app/inbox/${encodeURIComponent(card.approvalId)}`} className="scr-chip-link">
          <Chip tone="waiting">{card.kind === "short" ? "Batch waits on you" : "Price waits on you"}</Chip>
        </a>
      ) : (
        <span>
          <Chip tone="waiting">Waits on you</Chip>
        </span>
      );
    case "failed":
    case "cancelled":
      return card.project ? (
        <span className="scr-dialog-actions">
          <Button small variant="dark" disabled={busy} onClick={() => actions.retry(card)}>
            Process again
          </Button>
          <LinkButton small variant="ghost" href="/app/editor?panel=upload">
            Use another video
          </LinkButton>
        </span>
      ) : card.kind === "post_image" ? (
        <LinkButton small variant="ghost" href="/app/editor">
          Try another prompt
        </LinkButton>
      ) : null;
    case "ready":
    case "finished":
      return (
        <span className="scr-card-actions">
          {(card.project || card.editorHref) && (
            <Button small variant="ghost" onClick={() => actions.openInEditor(card)} disabled={busy}>
              Open in editor
            </Button>
          )}
          {card.canMarkFinished && (
            <Button small variant="dark" disabled title="Marking an edit finished arrives with Studio's shorts">
              Mark finished
            </Button>
          )}
        </span>
      );
  }
}
