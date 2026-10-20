"use client";

/**
 * One uploaded video on the web: progress, the error, or the way into the editor.
 *
 * `useLive` listens to this project's `jobs` row and re-reads `GET /projects/[id]`. The 5-second
 * poll still runs as a safety net, because Realtime can miss an event while the channel stays up;
 * the `clips` subscription shares the `jobs` read, so it opens no second timer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Project } from "@/lib/clipping-types";

import { ApiError, api, jsonBody } from "../api";
import { PageSkeleton } from "../Skeleton";
import { ProcessingView, stageLabel } from "../ProcessingView";
import { Notice, Toast } from "../ui";
import { useLive } from "../useLive";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** `m:ss`, or `h:mm:ss` past an hour. */
function duration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function ProjectView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef(0);
  const reading = useRef(false);
  const actionPending = useRef(false);

  const load = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const seq = ++request.current;
    try {
      const next = await api<Project>(`/projects/${encodeURIComponent(projectId)}`);
      if (seq !== request.current) return;
      setProject(next);
      setMissing(false);
      setLoadError(null);
    } catch (err) {
      if (seq !== request.current) return;
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      else setLoadError(err instanceof Error ? err.message : "Could not open this project.");
    } finally {
      reading.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Job đổi trạng thái/stage, hoặc clip đầu tiên xuất hiện.
  const live = project === null || !TERMINAL.has(project.status);
  useLive("jobs", `id=eq.${projectId}`, () => void load(), live);
  useLive("clips", `job_id=eq.${projectId}`, () => void load(), live, false);

  // Progress in the tab title: a user waiting in another tab still sees the stage. The old title
  // comes back when it finishes or the page closes.
  const activeTitle = project && !TERMINAL.has(project.status) ? stageLabel(project) : null;
  useEffect(() => {
    if (!activeTitle) return;
    const original = document.title;
    document.title = `${activeTitle} · OpenCMO`;
    return () => {
      document.title = original;
    };
  }, [activeTitle]);

  async function run(action: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn’t work. Please try again.");
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <section className="job-detail">
        <div className="empty-state">
          <p>This project is no longer in your library.</p>
          <button type="button" className="primary-button" onClick={() => router.push("/app/editor?panel=upload")}>
            Upload a video
          </button>
        </div>
      </section>
    );
  }

  if (!project) {
    return (
      <section className="job-detail">
        {loadError ? <Notice>{loadError}<button type="button" className="secondary-button" onClick={() => void load()}>Retry loading project</button></Notice> : <PageSkeleton variant="project" />}
      </section>
    );
  }

  // An upload becomes exactly one editable clip (`kind = 'full'`).
  const editable = project.clips[0] ?? null;

  return (
    <section className="job-detail">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/app/projects">My projects</Link>
        <span aria-hidden="true">/</span>
        <b>{project.title || project.source_name || "Your video"}</b>
      </nav>
      {error && <Notice>{error}</Notice>}
      {loadError && <Notice>{loadError} <button type="button" className="secondary-button" onClick={() => void load()}>Refresh project</button></Notice>}

      <div className="project-head">
        <div className="project-head-text">
          {renaming !== null ? (
            <form
              className="rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  setProject(
                    await api<Project>(
                      `/projects/${project.id}`,
                      jsonBody({ title: renaming.trim() }, "PATCH"),
                    ),
                  );
                  setRenaming(null);
                  setToast("Title updated.");
                });
              }}
            >
              <input
                aria-label="Project title"
                value={renaming}
                maxLength={120}
                autoFocus
                onChange={(event) => setRenaming(event.target.value)}
              />
              <button className="primary-button" disabled={busy || !renaming.trim()}>
                Save
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="project-title-row">
              <h1>{project.title || "Your video"}</h1>
              <button
                type="button"
                className="text-button"
                onClick={() => setRenaming(project.title || project.source_name)}
              >
                Rename
              </button>
            </div>
          )}

          <p className="source-detail">
            {project.source_name}
            {project.duration ? ` · ${duration(project.duration)}` : ""}
          </p>
        </div>

        {project.status === "done" && editable ? (
          <div className="project-actions">
            <button type="button" className="primary-button" data-testid="project-open-editor" onClick={() => router.push(`/app/editor/${editable.id}`)}>
              Open in editor
            </button>
          </div>
        ) : null}
      </div>

      {(project.status === "queued" || project.status === "running") && (
        <ProcessingView
          project={project}
          busy={busy}
          onCancel={() =>
            void run(async () => {
              setProject(
                await api<Project>(`/projects/${project.id}/cancel`, jsonBody({})),
              );
              setToast("Processing cancelled.");
            })
          }
        />
      )}

      {(project.status === "failed" || project.status === "cancelled") && (
        <div
          className={`processing-panel ${project.status === "failed" ? "failed-panel" : ""}`}
        >
          <h2>
            {project.status === "failed"
              ? "We couldn’t finish this video"
              : "Processing was cancelled"}
          </h2>
          {project.error && <p>{project.error}</p>}
          <p>Try again, or upload a different video.</p>
          <div className="panel-actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setProject(await api<Project>(`/jobs/${project.id}/retry`, jsonBody({})));
                  setToast("Processing this video again.");
                })
              }
            >
              {project.status === "failed" ? "Retry video" : "Process again"}
            </button>
            <button type="button" className="secondary-button" onClick={() => router.push("/app/editor?panel=upload")}>Use another video</button>
          </div>
        </div>
      )}

      {project.status === "done" && !editable && (
        <Notice>This video has no editable copy. Upload it again to edit it.</Notice>
      )}

      <Toast message={toast} onDone={() => setToast(null)} />
    </section>
  );
}
