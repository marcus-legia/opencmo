"use client";

/**
 * Thanh trên của shell: chọn clip (hoặc về trang project), trạng thái lưu, Undo/Redo, số credit
 * và Export.
 */

import { useEffect, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { ThemeSwitch } from "@/components/theme";
import type { SaveStatus } from "@/lib/editor/session";
import { createClient } from "@/lib/supabase/client";

export type ExportState =
  | { phase: "idle" }
  | { phase: "preparing" | "queued" }
  /** `progress` 0–1 do worker ghi; null khi worker chưa báo (thanh chạy dạng chờ). */
  | { phase: "running"; progress?: number | null }
  | { phase: "done"; url: string | null }
  | { phase: "failed"; error: string };

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  conflict: "Changed in another tab",
  error: "Couldn't save",
};

const EXPORT_LABEL: Record<ExportState["phase"], string> = {
  idle: "Export",
  preparing: "Saving…",
  queued: "Queued…",
  running: "Exporting…",
  done: "Export again",
  failed: "Try again",
};

export function TopBar({
  credits,
  status,
  error,
  canUndo,
  canRedo,
  exportState,
  generating,
  onBack,
  onUndo,
  onRedo,
  onRetry,
  onLoadLatest,
  onExport,
  onCancelExport,
  menu,
  picker,
  panels,
  finish,
}: {
  credits: number | null;
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  exportState: ExportState;
  /** Mục AI đang sinh (giọng, ảnh, video, cảnh 3D) — chưa về thư viện. */
  generating?: { key: string; label: string }[];
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  onLoadLatest: () => void;
  onExport: () => void;
  /** Huỷ export đang chờ/chạy (E2-d2). */
  onCancelExport?: () => void;
  /** Menu dự án (B7), trước nút Back như fork. */
  menu?: React.ReactNode;
  /** Ô chọn clip (E0) — editor là mục của rail, nên thay nút Back. */
  picker?: React.ReactNode;
  /** Nút bật/tắt panel + preset bố cục (Palmier `TitleBarLeadingView`). */
  panels?: React.ReactNode;
  /** P2 (v2 UI only): Mark finished for this edit, at the hash of the last save (null while changes are unsaved). */
  finish?: { clipId: string; documentHash: string | null };
}) {
  const exporting = ["preparing", "queued", "running"].includes(exportState.phase);
  return (
    <header className="ed2-top">
      <div className="ed2-row">
        {menu}
        {picker ?? (
          <button type="button" className="ed2-btn" data-testid="editor-back" onClick={onBack}>
            ← Back
          </button>
        )}
        <span className="beta-badge" title="The editor is in beta: some tools may not work as expected yet.">
          Beta
        </span>
        <span
          className="ed2-status"
          data-testid="save-status"
          data-state={status}
          title={error ?? undefined}
          role="status"
        >
          <i className="ed2-status-dot" aria-hidden="true" />
          {SAVE_LABEL[status]}
        </span>
        {status === "error" && error ? (
          <span className="ed2-error" role="alert" data-testid="save-error">
            {error}
          </span>
        ) : null}
        {status === "error" ? (
          <button type="button" className="ed2-link" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {status === "conflict" ? (
          <button type="button" className="ed2-link" data-testid="load-latest" onClick={onLoadLatest}>
            Load latest version
          </button>
        ) : null}
      </div>

      <div className="ed2-row">
        {panels}
        <button
          type="button"
          className="ed2-icon"
          data-testid="undo"
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          onClick={onUndo}
        >
          ↶
        </button>
        <button
          type="button"
          className="ed2-icon"
          data-testid="redo"
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          onClick={onRedo}
        >
          ↷
        </button>
      </div>

      <div className="ed2-row">
        {/* Editor là màn "bleed" (không có top bar chung) nên công tắc theme nằm ở đây. */}
        <ThemeSwitch className="ed2-theme" />
        {finish ? <MarkFinished clipId={finish.clipId} documentHash={finish.documentHash} /> : null}
        {credits !== null ? (
          <span className="ed2-muted ed2-credits" data-testid="editor-credits">
            <b>{credits.toLocaleString("en-US")}</b> credits
          </span>
        ) : null}
        {exportState.phase === "done" && exportState.url ? (
          <a className="ed2-link" data-testid="export-download" href={exportState.url}>
            Download
          </a>
        ) : null}
        {exportState.phase === "failed" ? (
          <span className="ed2-error" role="alert" data-testid="export-error">
            {exportState.error}
          </span>
        ) : null}
        {generating?.length ? (
          <span className="ed2-generating" role="status" aria-live="polite" data-testid="editor-generating" title={generating.map((item) => item.label).join(", ")}>
            <span aria-hidden className="ed2-asst-spinner" />
            {generating.length === 1 ? `Generating ${generating[0]!.label}…` : `Generating ${generating.length} items…`}
          </span>
        ) : null}
        {exporting ? <ExportMeter state={exportState} /> : null}
        {onCancelExport && (exportState.phase === "queued" || exportState.phase === "running") ? (
          <button type="button" className="ed2-link" data-testid="export-cancel" onClick={onCancelExport}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="ed2-btn ed2-primary"
          data-testid="toolbar-export"
          disabled={exporting || status === "conflict"}
          onClick={onExport}
        >
          {exportState.phase === "running" && typeof exportState.progress === "number"
            ? `Exporting ${Math.round(exportState.progress * 100)}%`
            : EXPORT_LABEL[exportState.phase]}
        </button>
      </div>
    </header>
  );
}

/**
 * Thanh tiến độ Export. Worker ghi tiến độ theo chặng (tải nguồn → vẽ → ghép
 * tiếng → tải lên); chưa có số thì chạy dạng chờ — người dùng phải thấy nó
 * đang chạy, không phải một nút "Exporting…" đứng im mấy phút (02/10).
 */
function ExportMeter({ state }: { state: ExportState }) {
  const value = state.phase === "running" && typeof state.progress === "number" ? Math.max(0, Math.min(1, state.progress)) : null;
  const stage =
    state.phase === "preparing"
      ? "Saving"
      : state.phase === "queued"
        ? "Waiting for a worker"
        : value === null || value < 0.08
          ? "Preparing media"
          : value < 0.93
            ? "Rendering"
            : "Finishing";
  return (
    <div className="ed2-export-meter" data-testid="export-progress">
      <span className="ed2-muted ed2-export-meter-label">{stage}</span>
      <div
        className={`ed2-export-meter-track${value === null ? " is-indeterminate" : ""}`}
        role="progressbar"
        aria-label="Export progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      >
        <div className="ed2-export-meter-fill" style={value === null ? undefined : { width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
  );
}

type Finish = { phase: "loading" } | { phase: "ready"; hash: string | null } | { phase: "busy"; hash: string | null };

/**
 * Mark finished (P2 C2): Shorts are cut only from an edit marked finished at the document the founder saw. The mark
 * is the last save's hash (`POST /api/v1/studio/[clipId]/finished`); any later save changes the hash and the server
 * clears the mark, so the badge here shows only while the saved document is the finished one. The browser never
 * hashes a document: it sends the hash the save handed back.
 */
function MarkFinished({ clipId, documentHash }: { clipId: string; documentHash: string | null }) {
  const [state, setState] = useState<Finish>({ phase: "loading" });
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void createClient()
      .from("editor_projects")
      .select("finished_hash")
      .eq("clip_id", clipId)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setState({ phase: "ready", hash: (data as { finished_hash: string | null } | null)?.finished_hash ?? null });
      });
    return () => {
      live = false;
    };
  }, [clipId]);

  const marked = state.phase !== "loading" ? state.hash : null;
  const finished = !!marked && marked === documentHash;
  const busy = state.phase !== "ready";

  async function markFinished() {
    if (!documentHash || busy) return;
    setState({ phase: "busy", hash: marked });
    setNote(null);
    try {
      const done = await api<{ finishedAt: string; documentHash: string }>(`/studio/${encodeURIComponent(clipId)}/finished`, jsonBody({ documentHash }));
      setState({ phase: "ready", hash: done.documentHash });
      setNote({ text: "Marked finished. Shorts can be cut from it.", error: false });
    } catch (error) {
      setState({ phase: "ready", hash: marked });
      setNote({ text: error instanceof ApiError ? error.message : "Could not mark it finished. Please try again.", error: true });
    }
  }

  async function cutShorts() {
    if (busy) return;
    setState({ phase: "busy", hash: marked });
    setNote(null);
    try {
      await api<{ orderId: string }>(`/studio/${encodeURIComponent(clipId)}/shorts`, jsonBody({}));
      setNote({ text: "Cutting 3 shorts. The batch card comes to your Dashboard.", error: false });
    } catch (error) {
      setNote({ text: error instanceof ApiError ? error.message : "Could not start the shorts. Please try again.", error: true });
    } finally {
      setState((current) => ({ phase: "ready", hash: current.phase === "loading" ? marked : current.hash }));
    }
  }

  if (state.phase === "loading") return null;
  return (
    <>
      {note ? (
        <span className={note.error ? "ed2-error" : "ed2-muted"} role={note.error ? "alert" : "status"} data-testid="finished-note">
          {note.text}
        </span>
      ) : null}
      {finished ? (
        <>
          <span className="ed2-status" data-testid="finished-badge" title="Marked finished at the version you see">
            <i className="ed2-status-dot" aria-hidden="true" />
            Finished
          </span>
          <button type="button" className="ed2-btn" data-testid="cut-shorts" disabled={busy} onClick={() => void cutShorts()}>
            Cut shorts
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ed2-btn"
          data-testid="mark-finished"
          disabled={busy || !documentHash}
          title={documentHash ? "Shorts are cut only from an edit marked finished" : "Wait for the save, then mark it finished"}
          onClick={() => void markFinished()}
        >
          Mark finished
        </button>
      )}
    </>
  );
}
