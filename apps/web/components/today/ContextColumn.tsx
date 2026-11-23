"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";
import { useShellState } from "@/components/shell-v2/ShellState";
import type { FunnelRow } from "@/lib/cmo/funnel-view";

import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/cmo/documents";

import { ContextDrawer, DOC_ROWS, isDocId, missingDocument, type DocId } from "./ContextDrawer";
import { useLibraryCounts } from "./LibraryView";
import { CompanyLogo } from "./company-logo";
import { siteLabel, useWorkspace } from "./workspace";

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
    ? kept.map((c) => ({ key: c.id, name: c.name, site: c.site }))
    : ws.competitors.map((c) => ({ key: c.name, name: c.name || siteLabel(c.website) || "?", site: c.website }));
  const pct = goal && goal.total > 0 ? Math.round((goal.done / goal.total) * 100) : 0;

  // Blank until the workspace loads: a placeholder name and letter would flash before the real product.
  const name = ws.ready ? (ws.name ?? site ?? "Your business") : "";
  const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const steps = [
    { label: "Found", n: week?.found, sec: "find", d: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5" },
    { label: "Replied", n: week?.replied, sec: "idea", d: "M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4" },
    { label: "Answered back", n: week?.answeredBack, sec: "post", d: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" },
    { label: "Signed up", n: week?.signedUp, sec: "sol", d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM16 11l2 2 4-4" },
  ] as const;

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
      {/* The product, by its own logo (owner, 2026-11-23: fewer words; the summary lives in the Product document). */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", borderRadius: "14px", background: "var(--raised)", margin: "0 0 10px" }} data-testid="context-product">
        <CompanyLogo name={name} site={ws.site} size={38} />
        <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "3px" }}>
          <b style={{ fontSize: "15px", fontWeight: "650", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</b>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--muted)", minWidth: "0" }}>
            {site ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site}</span> : null}
            {ws.category ? <span style={{ padding: "1px 6px", borderRadius: "5px", background: "var(--sec-find-wash)", color: "var(--sec-find)", fontWeight: "650", flex: "0 0 auto" }}>{ws.category}</span> : null}
          </span>
        </span>
        <button type="button" className="ib" aria-label="Edit context" title="Edit context" onClick={() => openDoc("product")}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          </svg>
        </button>
      </div>

      {/* Your business and Library side by side, each a coloured icon and a number. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "8px", margin: "0 0 14px" }}>
        <button
          type="button"
          onClick={() => router.push(`/app/business${missing ? `?d=${missing}` : ""}`)}
          data-testid="context-documents"
          title={missing ? "Your business: one document still to write" : `Your business: ${docCount} documents every step reads`}
          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px", border: "1px solid var(--line)", borderRadius: "12px", background: "transparent", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span className="sec-tile" data-sec="biz" style={{ width: "28px", height: "28px", borderRadius: "8px" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "15px", height: "15px" }}>
              <rect x="3" y="7" width="18" height="13" rx="2" />
              <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
            <b style={{ fontSize: "13px" }}>Business</b>
            <span className="meta" style={{ color: missing ? "var(--warn)" : undefined }}>{missing ? "1 to write" : docCount}</span>
          </span>
          {DOC_ROWS.some((row) => (DOCUMENT_KINDS as readonly string[]).includes(row.id) && isToday(ws.documents[row.id as DocumentKind]?.at)) ? <span className="live" title="Updated today" style={{ marginLeft: "auto" }}></span> : null}
        </button>
        <a
          href="/app/library"
          data-testid="context-library"
          aria-current={pathname === "/app/library" ? "page" : undefined}
          title="Library: what people said"
          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px", border: `1px solid ${pathname === "/app/library" ? "var(--sec-find)" : "var(--line)"}`, borderRadius: "12px", color: "inherit", textDecoration: "none" }}
        >
          <span className="sec-tile" data-sec="find" style={{ width: "28px", height: "28px", borderRadius: "8px" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "15px", height: "15px" }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
            </svg>
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
            <b style={{ fontSize: "13px" }}>Library</b>
            <span className="meta">
              {library ? library.total : "–"}
              {library ? <span className="sr-only">{library.total === 1 ? " conversation" : " conversations"}</span> : null}
              {library && library.thisWeek > 0 ? (
                <span style={{ color: "var(--ok)", fontWeight: "650" }}>
                  {" "}+{library.thisWeek}
                  <span className="sr-only"> this week</span>
                </span>
              ) : null}
            </span>
          </span>
        </a>
      </div>

      {/* The funnel of the week: one colour and icon per step, the label in its title. */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px" }} data-testid="context-funnel">
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>This week</h2>
          <a href="/app/analytics" aria-label="Analytics" title="Analytics" style={{ color: "var(--sec-stats)", display: "inline-flex" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "16px", height: "16px", ...ICON }}>
              <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
            </svg>
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "6px", padding: "0 6px" }}>
          {steps.map((step) => (
            <div key={step.label} data-testid="context-funnel-step" title={step.label} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "11px", background: `var(--sec-${step.sec}-wash)`, color: `var(--sec-${step.sec})` }}>
              <svg viewBox="0 0 24 24" role="img" aria-label={step.label} style={{ width: "17px", height: "17px", ...ICON }}>
                <path d={step.d} />
              </svg>
              <b style={{ fontSize: "18px", fontWeight: "650" }}>{step.n ?? "–"}</b>
              <span className="sr-only">{step.label}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 6px 0", display: "flex", alignItems: "center", gap: "8px" }} title={goal?.text ? `Goal: ${goal.text}` : "No goal yet. It comes with the week's plan."}>
          <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "14px", height: "14px", color: "var(--muted)", flex: "0 0 auto", ...ICON }}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1" />
          </svg>
          {goal && goal.total > 0 ? (
            <>
              <span style={{ flex: "1", height: "6px", borderRadius: "3px", background: "var(--line)", overflow: "hidden" }}>
                <span style={{ display: "block", width: `${Math.max(pct, 3)}%`, height: "6px", background: "var(--sec-sol)" }}></span>
              </span>
              <b style={{ fontSize: "12.5px" }}>
                {goal.done}/{goal.total}
              </b>
            </>
          ) : (
            <span className="meta">No goal yet</span>
          )}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px", marginTop: "14px" }} data-testid="context-competitors">
        <div className="sec" style={{ padding: "0 6px" }}>
          <h2>
            Competitors{" "}
            <span className="meta" style={{ marginLeft: "4px" }}>
              {ws.ready ? rivals.length : ""}
            </span>
          </h2>
          <a href="/app/research" aria-label="Research" title="Research" style={{ color: "var(--sec-find)", display: "inline-flex" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "16px", height: "16px", ...ICON }}>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div className="doc" style={{ alignItems: "center", background: "var(--sec-find-wash)", borderRadius: "10px" }}>
            <CompanyLogo name={name} site={ws.site} size={20} />
            <span style={{ fontSize: "13.5px", fontWeight: "600", flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            <span style={{ fontSize: "10.5px", fontWeight: "750", letterSpacing: "0.1em", color: "var(--sec-find)" }}>YOU</span>
          </div>
          {rivals.slice(0, 8).map((c) => (
            <div key={c.key} className="doc" style={{ alignItems: "center" }}>
              <CompanyLogo name={c.name} site={c.site} size={20} />
              <span style={{ fontSize: "13.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
            </div>
          ))}
        </div>
        {rivals.length > 8 ? (
          <a href="/app/research" className="meta" style={{ display: "block", padding: "4px 6px 0" }}>
            {rivals.length - 8} more
          </a>
        ) : ws.ready && kept !== null && rivals.length === 0 ? (
          <a href="/app/research" className="meta" style={{ display: "block", padding: "4px 6px 0" }}>
            Add the tools your customers compare you with
          </a>
        ) : null}
      </div>
      {isDocId(doc) ? <ContextDrawer doc={doc} edit={editing} onClose={() => router.push(pathname, { scroll: false })} onOpen={openDoc} /> : null}
    </aside>
  );
}
