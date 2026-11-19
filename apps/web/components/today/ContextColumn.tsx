"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";

import { ContextDrawer, DOC_ROWS, isDocId, missingDocument, type DocId } from "./ContextDrawer";
import { useLibraryCounts } from "./LibraryView";
import { siteLabel, useWorkspace } from "./workspace";

/** The artboard's colour squares for competitors, in order. */
const SWATCH = ["#d9467a", "#e9773a", "#5b6ee1", "#3aa58a", "#8a63d2", "#c9a227"];

const DocIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ marginTop: "2px", color: "var(--muted)" }}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);

const Plus = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

const isToday = (iso: string | undefined) => (iso ? new Date(iso).toDateString() === new Date().toDateString() : false);

/**
 * The Context column (redesign 2026-11-19): what Ferreto knows about the business, one card for its documents, the
 * week's goal and the competitors. A document opens the Context drawer (`?doc=`), which lists all of them.
 */
export function ContextColumn({ goal }: { goal: { text: string | null; done: number; total: number } | null }) {
  const ws = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const doc = params.get("doc");
  const editing = params.get("edit") === "1";
  // The drawer opens over the feed; `edit=1` opens the document's form. One URL, so Back closes it.
  // Over the view the founder is on (Feed, Calendar, Sales, Analytics): closing it leaves them where they were.
  const pathname = usePathname() ?? "/app";
  const openDoc = (id: DocId, edit = false) => router.push(`${pathname}?doc=${id}${edit ? "&edit=1" : ""}`, { scroll: false });
  const missing = ws.ready ? missingDocument(ws.documents) : null;
  const site = siteLabel(ws.site);
  const docCount = DOC_ROWS.length;
  const library = useLibraryCounts();
  const pct = goal && goal.total > 0 ? Math.round((goal.done / goal.total) * 100) : 0;

  const chip = (icon: ReactNode, label: string) => (
    <span className="chip" key={label}>
      {icon}
      {label}
    </span>
  );

  return (
    <aside className="left" id="td-context" aria-label="Context">
      <div className="sec" style={{ padding: "0 6px" }}>
        <h2>Context</h2>
        <button type="button" className="ib" aria-label="Edit context" onClick={() => openDoc("product")}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          </svg>
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "0 6px", marginBottom: "10px" }}>
        {ws.category
          ? chip(
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
                <circle cx="7.5" cy="7.5" r=".5" />
              </svg>,
              ws.category,
            )
          : null}
        {site
          ? chip(
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>,
              site,
            )
          : null}
      </div>
      {ws.summary ? (
        <>
          <p style={{ margin: "0 6px 4px", color: "var(--muted)", fontSize: "13.5px", lineHeight: "1.5", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ws.summary}</p>
          <button type="button" onClick={() => openDoc("product")} style={{ border: "0", background: "transparent", color: "var(--text)", fontSize: "13px", padding: "0 6px", marginBottom: "16px", textDecoration: "underline", textUnderlineOffset: "2px" }}>
            View more
          </button>
        </>
      ) : null}

      {/* One card for the documents (owner, 2026-11-18: the list here repeated the drawer's own list). */}
      <button
        type="button"
        onClick={() => router.push(`/app/business${missing ? `?d=${missing}` : ""}`)}
        data-testid="context-documents"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "10px", margin: "0 0 12px", border: "1px solid var(--line)", borderRadius: "10px", background: "transparent", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }}
      >
        <DocIcon />
        <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "13.5px", fontWeight: "500" }}>Your business</span>
          <span className="meta">{missing ? "One document still to write" : `${docCount} documents every step reads`}</span>
        </span>
        {DOC_ROWS.some((row) => (DOCUMENT_KINDS as readonly string[]).includes(row.id) && isToday(ws.documents[row.id as DocumentKind]?.at)) ? <span className="live" title="Updated today"></span> : null}
        <span className="meta" style={{ color: "var(--accent)" }}>Open</span>
      </button>

      {/* What people said (wave 3): Post writes from it, so it sits under the business it serves. */}
      <a
        href="/app/library"
        data-testid="context-library"
        aria-current={pathname === "/app/library" ? "page" : undefined}
        style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px", margin: "0 0 12px", border: `1px solid ${pathname === "/app/library" ? "var(--accent)" : "var(--line)"}`, borderRadius: "10px", color: "inherit", textDecoration: "none" }}
      >
        <span style={{ fontSize: "13.5px", fontWeight: "500" }}>Library</span>
        <span className="meta">{library ? `${library.total} ${library.total === 1 ? "conversation" : "conversations"}` : ""}</span>
        {library && library.thisWeek > 0 ? (
          <span className="meta" style={{ marginLeft: "auto", color: "var(--ok)" }}>
            +{library.thisWeek} this week
          </span>
        ) : null}
      </a>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "10px" }}>
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>Goal this week</h2>
          <span className="meta">{goal ? `${goal.done} / ${goal.total}` : ""}</span>
        </div>
        <div style={{ padding: "0 6px" }}>
          <div style={{ fontSize: "13.5px", marginBottom: "6px" }}>{goal?.text ?? "No goal yet. It comes with the week's plan."}</div>
          <div style={{ height: "4px", borderRadius: "4px", background: "var(--line-2)" }}>
            <div style={{ width: `${pct}%`, height: "4px", borderRadius: "4px", background: "var(--accent)" }}></div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "14px" }}>
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>
            Competitors{" "}
            <span className="meta" style={{ marginLeft: "4px" }}>
              {ws.competitors.length}
            </span>
          </h2>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <a href="/app/research" className="meta" style={{ color: "var(--accent)", textDecoration: "none" }}>
              Research
            </a>
            <button type="button" className="ib" aria-label="Add a competitor" onClick={() => openDoc("competitors", true)}>
              <Plus />
            </button>
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "2px" }}>
          {ws.competitors.map((c, i) => (
            <div key={c.name} className="doc" style={{ alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "5px", background: SWATCH[i % SWATCH.length], color: "#fff", display: "inline-grid", placeItems: "center", fontSize: "10.5px", fontWeight: "700", flexShrink: 0 }}>
                {(c.name || siteLabel(c.website) || "?").charAt(0).toUpperCase()}
              </span>
              <span style={{ fontSize: "13.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{siteLabel(c.website) ?? c.name}</span>
            </div>
          ))}
        </div>
      </div>
      {isDocId(doc) ? <ContextDrawer doc={doc} edit={editing} onClose={() => router.push(pathname, { scroll: false })} onOpen={openDoc} /> : null}
    </aside>
  );
}
