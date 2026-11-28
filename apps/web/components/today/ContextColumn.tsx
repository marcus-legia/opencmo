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
  // Each number with its word (redesign 2026-11-28: a first-time founder could not tell four coloured numbers apart).
  const steps = [
    { label: "Found", n: week?.found },
    { label: "Replied", n: week?.replied },
    { label: "Answered back", n: week?.answeredBack },
    { label: "Signed up", n: week?.signedUp },
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
      <div className="td-ctx-product" data-testid="context-product">
        <CompanyLogo name={name} site={ws.site} size={32} />
        <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
          <b>{name}</b>
          <span className="td-ctx-sub">
            {site ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{site}</span> : null}
            {site && ws.category ? <span aria-hidden="true">·</span> : null}
            {ws.category ? <span style={{ flex: "0 0 auto" }}>{ws.category}</span> : null}
          </span>
        </span>
        <button type="button" className="ib" aria-label="Edit context" title="Edit context" onClick={() => openDoc("product")}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          </svg>
        </button>
      </div>

      {/* Your business and Library side by side. */}
      <div className="td-ctx-links">
        <button
          type="button"
          className="td-ctx-link"
          onClick={() => router.push(`/app/business${missing ? `?d=${missing}` : ""}`)}
          data-testid="context-documents"
          title={missing ? "Your business: one document still to write" : `Your business: ${docCount} documents every step reads`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>
            <b>Business</b>
            <span className="meta" style={{ color: missing ? "var(--warn)" : undefined }}>{missing ? "1 to write" : docCount}</span>
          </span>
          {DOC_ROWS.some((row) => (DOCUMENT_KINDS as readonly string[]).includes(row.id) && isToday(ws.documents[row.id as DocumentKind]?.at)) ? <span className="live" title="Updated today" style={{ marginLeft: "auto" }}></span> : null}
        </button>
        <a href="/app/library" className="td-ctx-link" data-testid="context-library" aria-current={pathname === "/app/library" ? "page" : undefined} title="Library: what people said">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
          </svg>
          <span>
            <b>Library</b>
            <span className="meta">
              {library ? library.total : "–"}
              {library ? <span className="sr-only">{library.total === 1 ? " conversation" : " conversations"}</span> : null}
              {library && library.thisWeek > 0 ? (
                <span style={{ color: "var(--ok)", fontWeight: "600" }}>
                  {" "}+{library.thisWeek}
                  <span className="sr-only"> this week</span>
                </span>
              ) : null}
            </span>
          </span>
        </a>
      </div>

      {/* The funnel of the week: each step's number with its word. */}
      <div className="td-ctx-sec" data-testid="context-funnel">
        <div className="sec">
          <h2>This week</h2>
          <a href="/app/analytics" aria-label="Analytics" title="Analytics">
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "15px", height: "15px", ...ICON }}>
              <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
            </svg>
          </a>
        </div>
        <div className="td-week">
          {steps.map((step) => (
            <div key={step.label} className="td-week-step" data-testid="context-funnel-step">
              <b>{step.n ?? "–"}</b>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
        <div className="td-goal" title={goal?.text ? `Goal: ${goal.text}` : "No goal yet. It comes with the week's plan."}>
          <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "14px", height: "14px", flex: "0 0 auto", ...ICON }}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1" />
          </svg>
          {goal && goal.total > 0 ? (
            <>
              <span className="ui-meter" aria-hidden="true">
                <span style={{ width: `${Math.max(pct, 3)}%` }}></span>
              </span>
              <b>
                {goal.done}/{goal.total}
              </b>
              <span className="sr-only">of this week's goal done</span>
            </>
          ) : (
            <span>No goal yet</span>
          )}
        </div>
      </div>

      <div className="td-ctx-sec" data-testid="context-competitors">
        <div className="sec">
          <h2>
            Competitors{" "}
            <span className="meta" style={{ marginLeft: "4px" }}>
              {ws.ready ? rivals.length : ""}
            </span>
          </h2>
          <a href="/app/research" aria-label="Research" title="Research">
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: "15px", height: "15px", ...ICON }}>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
        <ul className="td-rivals">
          <li className="td-rival is-you">
            <CompanyLogo name={name} site={ws.site} size={20} />
            <span className="td-rival-name">{name}</span>
            <span className="td-you">You</span>
          </li>
          {rivals.slice(0, 8).map((c) => (
            <li key={c.key} className="td-rival">
              <CompanyLogo name={c.name} site={c.site} size={20} />
              <span className="td-rival-name">{c.name}</span>
            </li>
          ))}
        </ul>
        {rivals.length > 8 ? (
          <a href="/app/research" className="td-ctx-more">
            {rivals.length - 8} more
          </a>
        ) : ws.ready && kept !== null && rivals.length === 0 ? (
          <a href="/app/research" className="td-ctx-more">
            Add the tools your customers compare you with
          </a>
        ) : null}
      </div>
      {isDocId(doc) ? <ContextDrawer doc={doc} edit={editing} onClose={() => router.push(pathname, { scroll: false })} onOpen={openDoc} /> : null}
    </aside>
  );
}
