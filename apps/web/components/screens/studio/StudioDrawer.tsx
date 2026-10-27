"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Elapsed } from "@/components/Elapsed";
import { ApiError, api } from "@/components/clipping/api";
import { stageLabel } from "@/components/clipping/ProcessingView";
import { useLive } from "@/components/clipping/useLive";
import type { Project } from "@/lib/clipping-types";

import { shortDate } from "../format";
import { Button, ErrorNote, LinkButton, MonoLabel } from "../kit";
import type { CardActions } from "./StudioCard";
import type { Card } from "./model";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/**
 * The item drawer (`?item=<id>`): what `/app/projects/[id]` showed, over the grid. For an upload it reads
 * `GET /projects/[id]` and follows its job live, like the old page did.
 */
export function StudioDrawer({
  card,
  missing,
  busy,
  actions,
  onClose,
  onProject,
}: {
  card: Card | null;
  /** The URL names an item that is not in the loaded list: try it as an upload by id. */
  missing: string | null;
  busy: boolean;
  actions: CardActions;
  onClose: () => void;
  onProject: (project: Project) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const projectId = card?.project?.id ?? missing;
  const [project, setProject] = useState<Project | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const open = !!(card || missing);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    setProject(null);
    setGone(false);
    setError(null);
    setConfirming(false);
    setRenaming(null);
  }, [projectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const next = await api<Project>(`/projects/${encodeURIComponent(projectId)}`);
      setProject(next);
      onProject(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
      else setError(err instanceof Error ? err.message : "Could not open this item.");
    }
  }, [projectId, onProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = !!project && !TERMINAL.has(project.status);
  useLive("jobs", projectId ? `id=eq.${projectId}` : null, () => void load(), !!projectId && (project === null || running), true, "studio-item");

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const title = project?.title || project?.source_name || card?.title || "Item";
  const view: Card | null = card ?? null;

  return (
    <dialog ref={ref} className="scr-dialog scr-drawer" aria-labelledby="studio-item-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="scr scr-dialog-body">
        <div className="scr-dialog-head">
          <MonoLabel small>{projectId ? "Your upload" : view ? view.kind.replace("_", " ") : ""}</MonoLabel>
          <Button variant="quiet" small onClick={onClose}>
            Close
          </Button>
        </div>
        {gone ? (
          <>
            <h2 id="studio-item-title" className="scr-dialog-title">This item is no longer in Studio.</h2>
            <LinkButton href="/app/editor?panel=upload" variant="primary">
              Upload a video
            </LinkButton>
          </>
        ) : (
          <>
            <h2 id="studio-item-title" className="scr-dialog-title">
              {title}
            </h2>
            {error && <ErrorNote>{error}</ErrorNote>}
            {projectId && !project && !error && <p className="scr-muted">Loading…</p>}

            {project && (
              <>
                <p className="scr-small scr-muted">
                  {project.source_name} · added {shortDate(project.created_at)}
                </p>
                {running && (
                  <div className="scr-drawer-block" role="status" aria-live="polite">
                    <b>{stageLabel(project)}</b>
                    <span className="scr-small scr-muted">It opens in the editor when it is ready.</span>
                    <Elapsed since={project.attempt_started_at ?? project.created_at} />
                    <Button small variant="ghost" disabled={busy} onClick={() => card && actions.cancel(card)}>
                      Cancel processing
                    </Button>
                  </div>
                )}
                {(project.status === "failed" || project.status === "cancelled") && (
                  <div className="scr-drawer-block is-failed">
                    <b>{project.status === "failed" ? "We couldn’t finish this video" : "Processing was cancelled"}</b>
                    {project.error && <span className="scr-small">{project.error}</span>}
                    <span className="scr-dialog-actions">
                      <Button small variant="dark" disabled={busy || !card} onClick={() => card && actions.retry(card)}>
                        Process again
                      </Button>
                      <LinkButton small variant="ghost" href="/app/editor?panel=upload">
                        Use another video
                      </LinkButton>
                    </span>
                  </div>
                )}
                {project.status === "done" && (
                  <div className="scr-drawer-block">
                    <MonoLabel small>Edits made from it</MonoLabel>
                    {project.clips.filter((c) => c.id).length === 0 ? (
                      <span className="scr-small scr-muted">This video has no editable copy. Upload it again to edit it.</span>
                    ) : (
                      <ul className="scr-edits">
                        {project.clips
                          .filter((c) => c.id)
                          .map((clip, i) => (
                            <li key={clip.id}>
                              <span>{i === 0 ? "Full edit" : `Edit ${i + 1}`}</span>
                              <a href={`/app/editor/${encodeURIComponent(clip.id!)}`} data-testid={i === 0 ? "project-open-editor" : undefined}>
                                Open in editor
                              </a>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}

            {!projectId && view && (
              <>
                <p className="scr-small scr-muted">{view.failure ?? view.subtitle}</p>
                {view.edits.length > 0 && (
                  <div className="scr-drawer-block">
                    <MonoLabel small>Edits made from it</MonoLabel>
                    <ul className="scr-edits">
                      {view.edits.map((edit) => (
                        <li key={edit.id}>
                          <span>
                            {edit.title} · {shortDate(edit.editedAt)}
                          </span>
                          <a href={edit.editorHref}>Open in editor</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {view.editorHref && (
                  <LinkButton href={view.editorHref} variant="primary">
                    Open in editor
                  </LinkButton>
                )}
                {view.approvalId && <LinkButton href={`/app/inbox/${encodeURIComponent(view.approvalId)}`}>Open the approval</LinkButton>}
              </>
            )}

            {card?.project && renaming !== null && (
              <form
                className="scr-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!renaming.trim()) return;
                  actions.rename(card, renaming.trim());
                  setProject((p) => (p ? { ...p, title: renaming.trim() } : p));
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
            )}
            {card?.project && renaming === null && (
              <div className="scr-dialog-actions scr-drawer-foot">
                <Button small variant="ghost" onClick={() => setRenaming(title)}>
                  Rename
                </Button>
                <Button
                  small
                  variant="danger"
                  disabled={busy}
                  data-confirming={confirming || undefined}
                  onClick={() => {
                    if (!confirming) {
                      setConfirming(true);
                      return;
                    }
                    setConfirming(false);
                    actions.remove(card);
                    onClose();
                  }}
                >
                  {confirming ? "Delete? Tap again" : "Delete"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
