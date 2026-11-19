"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { api } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { FunnelRow } from "@/lib/cmo/funnel-view";

import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";

import { ContextDrawer, DOC_ROWS, isDocId, missingDocument, type DocId } from "./ContextDrawer";
import { useLibraryCounts } from "./LibraryView";
import { Mark } from "./ResearchView";
import { siteLabel, useWorkspace } from "./workspace";

const DocIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ marginTop: "2px", color: "var(--muted)" }}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);

const isToday = (iso: string | undefined) => (iso ? new Date(iso).toDateString() === new Date().toDateString() : false);

/** Found, replied, answered back and signed up over the last 7 days, all sources; null until read. */
function useFunnelWeek(): FunnelRow | null {
  const [row, setRow] = useState<FunnelRow | null>(null);
  const { workVersion } = useShellState();
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    api<{ rows: FunnelRow[] }>("/sales/funnel?days=7")
      .then((r) => alive && setRow(r.rows.find((x) => x.source === "all") ?? null))
      .catch(() => {
        // The tiles show a dash until a read works.
      });
    return () => {
      alive = false;
    };
  }, [workVersion, pathname]);
  return row;
}

/** The competitors kept in Research, read once per change of work (an Add in Research reloads the shell's version). */
function useKeptCompetitors(): { id: string; name: string; site: string }[] | null {
  const [list, setList] = useState<{ id: string; name: string; site: string }[] | null>(null);
  const { workVersion } = useShellState();
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    api<{ competitors: { id: string; name: string; site: string }[] }>("/research/competitors")
      .then((r) => alive && setList(r.competitors))
      .catch(() => {
        // The document's list stays shown.
      });
    return () => {
      alive = false;
    };
  }, [workVersion, pathname]);
  return list;
}

/**
 * The Context column (redesign 2026-11-19): what Ferreto knows about the business, one card for its documents, the
 * week's goal and the competitors. A document opens the Context drawer (`?doc=`), which lists all of them.
 */
/** `onClose`: on a phone the column is a sheet opened from the top bar (wave 4 C1); the button that folds it again. */
export function ContextColumn({ goal, onClose }: { goal: { text: string | null; done: number; total: number } | null; onClose?: () => void }) {
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
  const kept = useKeptCompetitors();
  const week = useFunnelWeek();
  // The competitors the founder keeps in Research (wave 3); before any, the ones the Competitors document names.
  const rivals = kept?.length
    ? kept.map((c) => ({ key: c.id, name: c.name }))
    : ws.competitors.map((c) => ({ key: c.name, name: c.name || siteLabel(c.website) || "?" }));
  const pct = goal && goal.total > 0 ? Math.round((goal.done / goal.total) * 100) : 0;

  const chip = (icon: ReactNode, label: string) => (
    <span className="chip" key={label}>
      {icon}
      {label}
    </span>
  );

  return (
    <aside className="left" id="td-context" aria-label="Context">
      {onClose ? (
        <button type="button" className="ib td-ctx-close" aria-label="Close context" onClick={onClose}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      ) : null}
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
          <button type="button" className="td-ctx-more" onClick={() => openDoc("product")} style={{ border: "0", background: "transparent", color: "var(--text)", fontSize: "13px", padding: "0 6px", marginBottom: "16px", textDecoration: "underline", textUnderlineOffset: "2px" }}>
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

      {/* The funnel of the week (wave 3): people, not posts. The week's goal stays under it. */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "10px" }} data-testid="context-funnel">
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>This week</h2>
          <a href="/app/analytics" className="meta" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Analytics
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "6px", padding: "0 6px", textAlign: "center" }}>
          {(
            [
              ["Found", week?.found],
              ["Replied", week?.replied],
              ["Answered back", week?.answeredBack],
              ["Signed up", week?.signedUp],
            ] as const
          ).map(([label, n]) => (
            <div key={label} data-testid="context-funnel-step" style={{ display: "flex", flexDirection: "column", padding: "6px 0", borderRadius: "7px", background: "var(--hover)" }}>
              <b style={{ fontSize: "16px", fontWeight: "600" }}>{n ?? "–"}</b>
              <span style={{ fontSize: "11px", lineHeight: "1.25", color: "var(--text)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 6px 0" }}>
          <div className="meta" style={{ marginBottom: "4px" }}>
            {goal?.text ? `Goal: ${goal.text}` : "No goal yet. It comes with the week's plan."}
            {goal && goal.total > 0 ? ` · ${goal.done} / ${goal.total}` : ""}
          </div>
          {goal && goal.total > 0 ? (
            <div style={{ height: "4px", borderRadius: "4px", background: "var(--line-2)" }}>
              <div style={{ width: `${pct}%`, height: "4px", borderRadius: "4px", background: "var(--accent)" }}></div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "14px" }} data-testid="context-competitors">
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>
            Competitors{" "}
            <span className="meta" style={{ marginLeft: "4px" }}>
              {rivals.length}
            </span>
          </h2>
          <a href="/app/research" className="meta" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Research
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "2px" }}>
          {rivals.slice(0, 8).map((c, i) => (
            <div key={c.key} className="doc" style={{ alignItems: "center" }}>
              <Mark name={c.name} index={i} size={18} />
              <span style={{ fontSize: "13.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
            </div>
          ))}
        </div>
        {rivals.length > 8 ? (
          <a href="/app/research" className="meta" style={{ display: "block", padding: "4px 6px 0" }}>
            {rivals.length - 8} more
          </a>
        ) : rivals.length === 0 ? (
          <a href="/app/research" className="meta" style={{ display: "block", padding: "4px 6px 0" }}>
            Add the tools your customers compare you with
          </a>
        ) : null}
      </div>
      {isDocId(doc) ? <ContextDrawer doc={doc} edit={editing} onClose={() => router.push(pathname, { scroll: false })} onOpen={openDoc} /> : null}
    </aside>
  );
}
