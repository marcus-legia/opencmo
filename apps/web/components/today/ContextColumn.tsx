"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";

import { ContextDrawer, DOC_ROWS, missingDocument, type DocId } from "./ContextDrawer";
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

const PaletteIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ marginTop: "2px", color: "var(--muted)" }}>
    <circle cx="13.5" cy="6.5" r=".5" />
    <circle cx="17.5" cy="10.5" r=".5" />
    <circle cx="8.5" cy="7.5" r=".5" />
    <circle cx="6.5" cy="12.5" r=".5" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
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
 * The Context column of the feed (Main.dc.html `.left`): what the CMO knows about the business, the documents every
 * agent reads, the week's goal and the competitors. A document opens the Context drawer (`?doc=`).
 */
export function ContextColumn({ goal }: { goal: { text: string | null; done: number; total: number } | null }) {
  const ws = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const doc = params.get("doc");
  const editing = params.get("edit") === "1";
  // The drawer opens over the feed; `edit=1` opens the document's form. One URL, so Back closes it.
  const openDoc = (id: DocId, edit = false) => router.push(`/app?doc=${id}${edit ? "&edit=1" : ""}`, { scroll: false });
  const missing = ws.ready ? missingDocument(ws.documents) : null;
  const site = siteLabel(ws.site);
  const docCount = DOC_ROWS.length;
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

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>
            Documents{" "}
            <span className="meta" style={{ marginLeft: "4px" }}>
              {docCount}
            </span>
          </h2>
          {missing ? (
            <button type="button" className="ib" aria-label="Write a missing document" onClick={() => openDoc(missing, true)}>
              <Plus />
            </button>
          ) : null}
        </div>
        {DOC_ROWS.map((row) => {
          const kind = (DOCUMENT_KINDS as readonly string[]).includes(row.id) ? (row.id as DocumentKind) : null;
          const written = kind ? ws.documents[kind] : undefined;
          return (
            <button key={row.id} type="button" className="doc" onClick={() => openDoc(row.id)} style={{ width: "100%", border: "0", background: "transparent", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }}>
              {row.id === "brand" ? <PaletteIcon /> : <DocIcon />}
              <div style={{ flex: "1", minWidth: "0" }}>
                <span style={{ fontSize: "13.5px" }}>{row.title}</span>
                <span className="u">{row.readBy}</span>
              </div>
              {isToday(written?.at) ? <span className="live" style={{ marginTop: "6px" }} title="Updated today"></span> : null}
            </button>
          );
        })}
      </div>

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
          <button type="button" className="ib" aria-label="Add a competitor" onClick={() => openDoc("competitors", true)}>
            <Plus />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "2px" }}>
          {ws.competitors.map((c, i) => (
            <div key={c.name} className="doc" style={{ alignItems: "center" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "4px", background: SWATCH[i % SWATCH.length], display: "inline-block", flexShrink: 0 }}></span>
              <span style={{ fontSize: "13.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{siteLabel(c.website) ?? c.name}</span>
            </div>
          ))}
        </div>
      </div>
      {doc && DOC_ROWS.some((r) => r.id === doc) ? <ContextDrawer doc={doc as DocId} edit={editing} onClose={() => router.push("/app", { scroll: false })} onOpen={openDoc} /> : null}
    </aside>
  );
}
