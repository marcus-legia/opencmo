"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "@/components/clipping/api";
import { fillChat } from "@/components/dashboard/TodayBlock";
import { useShellState } from "@/components/shell-v2/ShellState";
import { useScreen } from "@/components/screens/useScreen";
import { DOCUMENTS, type DocumentKind } from "@/lib/cmo/documents";
import type { CmoState } from "@/lib/cmo/state";

export type DocId = DocumentKind | "brand";

/** The five documents of the Context column, with who reads each (Main.dc.html). */
export const DOC_ROWS: { id: DocId; title: string; readBy: string; readers: string[] }[] = [
  { id: "product", title: "Product", readBy: "Read by every agent", readers: ["Every agent"] },
  { id: "strategy", title: "Strategy", readBy: "Planner, Writer", readers: ["Planner", "Writer", "CMO chat"] },
  { id: "competitors", title: "Competitors", readBy: "Research, Sales", readers: ["Research", "Sales"] },
  { id: "content_strategy", title: "Content plan", readBy: "Planner, Writer", readers: ["Planner", "Writer"] },
  { id: "brand", title: "Brand Kit", readBy: "Post images, slideshows", readers: ["Studio"] },
];

const LIBRARY_TAB: Record<DocId, string> = { product: "business", strategy: "business", competitors: "business", content_strategy: "business", brand: "brand" };

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
 * over a scrim. Edit goes to the document's editor in Library; "Ask your CMO to change it" puts the request in the chat.
 */
export function ContextDrawer({ doc, onClose, onOpen }: { doc: DocId; onClose: () => void; onOpen: (id: DocId) => void }) {
  const { focusChat } = useShellState();
  const [state, setState] = useState<CmoState | null>(null);
  const [brain] = useScreen("brain");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void api<CmoState>("/cmo/documents")
      .then(setState)
      .catch(() => setState({ documents: {}, lastRun: null }));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = DOC_ROWS.find((r) => r.id === doc)!;
  const kind = doc === "brand" ? null : doc;
  const written = kind ? state?.documents[kind] : undefined;
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
            <Link href="/app/library" className="ib" aria-label="Add a document">
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </Link>
          </div>
          {DOC_ROWS.map((r) => (
            <button key={r.id} type="button" className="doc" aria-current={r.id === doc} onClick={() => onOpen(r.id)}>
              <DocIcon current={r.id === doc} />
              <span>
                <span style={{ fontSize: "12.5px", fontWeight: r.id === doc ? "500" : undefined }}>{r.title}</span>
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
                  <div style={{ fontSize: "12.5px", marginTop: "5px" }}>{l.text}</div>
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
            <span style={{ fontWeight: "600", fontSize: "14px" }}>{row.title}</span>
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
              ) : written ? (
                DOCUMENTS[kind].fields.map((f) => <Field key={f.key} label={f.label} value={written.body[f.key]} />)
              ) : (
                <p style={{ marginTop: "16px" }}>Not written yet. Your CMO writes it from your website, or you can write it yourself.</p>
              )
            ) : (
              <p style={{ marginTop: "16px" }}>Your logo, colours and fonts for post images and slideshows.</p>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--line)", flex: "none" }}>
            <span className="meta">Changes apply from the next draft.</span>
            <div style={{ flex: "1 1 auto" }}></div>
            {kind ? (
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
            ) : null}
            <Link href={`/app/library?tab=${LIBRARY_TAB[doc]}`} className="primary" style={{ textDecoration: "none" }}>
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              </svg>
              Edit
            </Link>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
