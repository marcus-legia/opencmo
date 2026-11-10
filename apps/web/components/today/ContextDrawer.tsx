"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api, jsonBody } from "@/components/clipping/api";
import { DocumentForm, type Body } from "@/components/cmo/DocumentFields";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { DOCUMENTS, type DocumentKind } from "@/lib/cmo/documents";
import type { CmoState, DocumentRow } from "@/lib/cmo/state";

import { useWorkspace } from "./workspace";

// The Brand Kit's editor draws a frame with the clip renderer: loaded only when the Brand Kit is open.
const BrandView = dynamic(() => import("@/components/clipping/web/BrandView").then((m) => m.BrandView), {
  ssr: false,
  loading: () => <p className="meta" style={{ marginTop: "16px" }}>Loading your Brand Kit…</p>,
});

export type DocId = DocumentKind | "brand";

/** The five documents of the Context column, with who reads each (Main.dc.html). */
export const DOC_ROWS: { id: DocId; title: string; readBy: string; readers: string[] }[] = [
  { id: "product", title: "Product", readBy: "Read by every agent", readers: ["Every agent"] },
  { id: "strategy", title: "Strategy", readBy: "Planner, Writer", readers: ["Planner", "Writer", "CMO chat"] },
  { id: "competitors", title: "Competitors", readBy: "Research, Sales", readers: ["Research", "Sales"] },
  { id: "content_strategy", title: "Content plan", readBy: "Planner, Writer", readers: ["Planner", "Writer"] },
  { id: "brand", title: "Brand Kit", readBy: "Post images, slideshows", readers: ["Studio"] },
];

/** The first document nobody has written yet, for the "+" of the Context column and the drawer; null when all are. */
export function missingDocument(written: Partial<Record<DocumentKind, unknown>>): DocumentKind | null {
  return (DOC_ROWS.find((r) => r.id !== "brand" && !written[r.id as DocumentKind])?.id as DocumentKind | undefined) ?? null;
}

const DocIcon = ({ current }: { current: boolean }) => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ marginTop: "2px", color: current ? "var(--accent)" : "var(--muted)" }}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
);

type Learned = { id: string; kind: string; scope: string; text: string; source: string };

function Field({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  if (Array.isArray(value)) {
    const items = value.filter((v) => typeof v === "string" || (v && typeof v === "object"));
    return (
      <>
        <h3>{label}</h3>
        <ol style={{ margin: "0", paddingLeft: "20px" }}>
          {items.map((v, i) => (
            <li key={i}>
              {typeof v === "string"
                ? v
                : Object.values(v as Record<string, unknown>)
                    .filter((x) => typeof x === "string" && x)
                    .join(" · ")}
            </li>
          ))}
        </ol>
      </>
    );
  }
  return (
    <>
      <h3>{label}</h3>
      <p>{String(value)}</p>
    </>
  );
}

const ago = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return "today";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
};

/**
 * The Context drawer (Context.dc.html): the documents on the left with what the CMO learned this week, the open document
 * over a scrim. Edit turns the document into its form right here and Save writes a new version: the founder never
 * leaves the feed (owner, 2026-11-10: fewer page jumps). The Brand Kit's own editor opens in the drawer too. "Ask your
 * CMO to change it" puts the request in the chat.
 */
export function ContextDrawer({ doc, edit = false, onClose, onOpen }: { doc: DocId; edit?: boolean; onClose: () => void; onOpen: (id: DocId, edit?: boolean) => void }) {
  const { focusChat, toast } = useShellState();
  const ws = useWorkspace();
  const [state, setState] = useState<CmoState | null>(null);
  const [draft, setDraft] = useState<Body | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brain] = useScreen("brain");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void api<CmoState>("/cmo/documents")
      .then(setState)
      .catch(() => setState({ documents: {}, lastRun: null }));
  }, []);

  // Escape leaves the form first (the draft is dropped, nothing saved), then the drawer.
  const editing = draft !== null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing) setDraft(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const row = DOC_ROWS.find((r) => r.id === doc)!;
  const kind = doc === "brand" ? null : doc;
  const written = kind ? state?.documents[kind] : undefined;
  const missing = state ? missingDocument(state.documents) : null;

  // `?edit=1` (a link from the CMO, "+", Research's "Add a competitor") opens the form; another document drops a draft.
  useEffect(() => {
    setError(null);
    setDraft(edit && kind && state ? structuredClone(state.documents[kind]?.body ?? {}) : null);
  }, [doc, edit, kind, state === null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!kind || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api<DocumentRow>(`/cmo/documents/${kind}`, jsonBody({ body: draft }, "PUT"));
      setState((was) => ({ lastRun: was?.lastRun ?? null, documents: { ...(was?.documents ?? {}), [kind]: saved } }));
      setDraft(null);
      ws.reload();
      toast(`${row.title} saved. Every draft from now on reads it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  const learned = (brain.status === "ready" ? ((brain.data as { learned?: Learned[] }).learned ?? []) : []).slice(0, 3);

  if (!mounted) return null;
  return createPortal(
    <div className="k pg-context td-layer td-ctx">
      <div style={{ display: "flex", minHeight: "calc(100vh - 48px)", position: "relative", flexWrap: "wrap", width: "100%" }}>
        <aside style={{ flex: "0 0 288px", background: "var(--panel)", borderRight: "1px solid var(--line)", padding: "14px 12px", position: "relative", zIndex: "2", overflow: "auto" }}>
          <div className="sec">
            <h2>
              Documents{" "}
              <span className="meta" style={{ marginLeft: "4px" }}>
                {DOC_ROWS.length}
              </span>
            </h2>
            <button type="button" className="ib" aria-label="Write a missing document" hidden={!missing} onClick={() => missing && onOpen(missing, true)}>
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
          </div>
          {DOC_ROWS.map((r) => (
            <button key={r.id} type="button" className="doc" aria-current={r.id === doc} onClick={() => onOpen(r.id)}>
              <DocIcon current={r.id === doc} />
              <span>
                <span style={{ fontSize: "13.5px", fontWeight: r.id === doc ? "500" : undefined }}>{r.title}</span>
                <span className="u">{r.readBy}</span>
              </span>
            </button>
          ))}

          {learned.length > 0 ? (
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "10px" }}>
              <div className="sec">
                <h2>What your CMO learned</h2>
                <span className="meta">this week</span>
              </div>
              {learned.map((l) => (
                <div key={l.id} className="lesson">
                  <span className="chip">{l.scope || l.kind}</span>
                  <div style={{ fontSize: "13.5px", marginTop: "5px" }}>{l.text}</div>
                  <div className="meta" style={{ marginTop: "3px" }}>
                    {l.source}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </aside>

        <div aria-hidden="true" onClick={onClose} style={{ position: "absolute", inset: "0 0 0 288px", background: "var(--scrim)", zIndex: "1" }}></div>

        <section
          className="drawer"
          aria-label={row.title}
          role="dialog"
          style={{ flex: "0 1 640px", minWidth: "0", background: "var(--panel)", borderRight: "1px solid var(--line)", position: "relative", zIndex: "2", display: "flex", flexDirection: "column", boxShadow: "12px 0 32px rgba(0,0,0,.18)", maxHeight: "calc(100vh - 48px)" }}
        >
          <div style={{ height: "52px", display: "flex", alignItems: "center", gap: "8px", padding: "0 12px 0 20px", borderBottom: "1px solid var(--line)", flex: "none" }}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--muted)" }}>
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            <span style={{ fontWeight: "600", fontSize: "15px" }}>{row.title}</span>
            {written ? (
              <span className="meta">
                · version {written.version} · updated {ago(written.created_at)} by {written.created_by === "user" ? "you" : "your CMO"}
              </span>
            ) : null}
            <div style={{ flex: "1 1 auto" }}></div>
            <button type="button" className="ib" aria-label="Close" onClick={onClose}>
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div style={{ flex: "1 1 auto", overflow: "auto", padding: "4px 28px 24px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "16px" }}>
              <span className="meta" style={{ alignSelf: "center" }}>
                Read by
              </span>
              {row.readers.map((r) => (
                <span key={r} className="chip">
                  {r}
                </span>
              ))}
            </div>
            {kind ? (
              !state ? (
                <p className="meta" style={{ marginTop: "16px" }}>Loading…</p>
              ) : draft ? (
                <div className="td-docform">
                  <DocumentForm fields={DOCUMENTS[kind].fields} value={draft} onChange={setDraft} idPrefix={`ctx-${kind}`} />
                  {error ? (
                    <p role="alert" className="td-docform-error">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : written ? (
                DOCUMENTS[kind].fields.map((f) => <Field key={f.key} label={f.label} value={written.body[f.key]} />)
              ) : (
                <p style={{ marginTop: "16px" }}>Not written yet. Your CMO writes it from your website, or you can write it yourself.</p>
              )
            ) : (
              <div className="td-brandhost v2" style={{ marginTop: "16px" }}>
                <BrandView />
              </div>
            )}
          </div>
          {kind ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--line)", flex: "none" }}>
              <span className="meta">{draft ? "Saving makes a new version." : "Changes apply from the next draft."}</span>
              <div style={{ flex: "1 1 auto" }}></div>
              {draft ? (
                <>
                  <button type="button" className="ghost" onClick={() => setDraft(null)} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" className="primary" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      onClose();
                      focusChat();
                      fillChat(`Change my ${row.title.toLowerCase()} document: `);
                    }}
                  >
                    Ask your CMO to change it
                  </button>
                  <button type="button" className="primary" disabled={!state} onClick={() => setDraft(structuredClone(written?.body ?? {}))}>
                    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                    </svg>
                    {written ? "Edit" : "Write it"}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>,
    document.body,
  );
}
