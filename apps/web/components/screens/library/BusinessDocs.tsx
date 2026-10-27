"use client";

import { useEffect, useRef, useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { DocumentForm, type Body } from "@/components/cmo/DocumentFields";
import { DOCUMENT_KINDS, DOCUMENTS, type DocumentKind } from "@/lib/cmo/documents";
import type { CmoState, DocumentRow } from "@/lib/cmo/state";

import { Button, EmptyState, ErrorNote, LinkButton, SkeletonBlocks } from "../kit";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);

/** One line that says what the document holds, from its own content. */
export function documentGist(kind: DocumentKind, body: Body): string {
  switch (kind) {
    case "product":
      return str(body.one_liner) || str(body.description) || DOCUMENTS.product.summary;
    case "strategy":
      return str(body.positioning) || DOCUMENTS.strategy.summary;
    case "competitors": {
      const n = count(body.competitors);
      return n ? `${n} ${n === 1 ? "competitor" : "competitors"} Research compares you with.` : DOCUMENTS.competitors.summary;
    }
    case "content_strategy": {
      const n = count(body.pillars);
      return n ? `${n} pillars, formats and a weekly rhythm. ${str(body.cadence)}`.trim() : DOCUMENTS.content_strategy.summary;
    }
  }
}

function provenance(kind: DocumentKind, row: DocumentRow): string {
  // Competitors is one repeating group: "1 fields" says nothing, the count of rows does.
  const n = kind === "competitors" ? count(row.body.competitors) : DOCUMENTS[kind].fields.length;
  const fields = kind === "competitors" ? `${n} ${n === 1 ? "competitor" : "competitors"}` : `${n} fields`;
  if (row.created_by === "agent") return `${fields} · drafted from your site · not edited yet`;
  const when = new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fields} · you edited ${when}`;
}

/** Library › Business: the four marketing documents, live. Edit opens today's field form. */
export function BusinessDocs() {
  const [state, setState] = useState<CmoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DocumentKind | null>(null);

  useEffect(() => {
    let alive = true;
    api<CmoState>("/cmo/documents")
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "Could not load your documents."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!state) return <SkeletonBlocks rows={2} />;

  const site = str(state.lastRun?.input.site).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const any = DOCUMENT_KINDS.some((kind) => state.documents[kind]);
  if (!any) {
    return (
      <EmptyState action={<LinkButton href="/app/setup" variant="primary">Start setup</LinkButton>}>
        No documents yet. Setup reads your website and drafts all four.
      </EmptyState>
    );
  }

  return (
    <div className="scr-lib-business">
      <p className="scr-small scr-muted">
        Research drafted these{site ? ` from ${site}` : ""}. You own them now: edit anything that is wrong.
      </p>
      <div className="scr-doc-grid">
        {DOCUMENT_KINDS.map((kind) => {
          const row = state.documents[kind];
          return (
            <article key={kind} className="scr-doc-card" data-kind={kind}>
              <h3>{DOCUMENTS[kind].title}</h3>
              <p className="scr-small">{row ? documentGist(kind, row.body) : DOCUMENTS[kind].summary}</p>
              <span className="scr-tiny scr-muted">{row ? provenance(kind, row) : "Not written yet"}</span>
              <Button small variant="ghost" onClick={() => setEditing(kind)} aria-label={`Edit ${DOCUMENTS[kind].title}`}>
                Edit
              </Button>
            </article>
          );
        })}
      </div>
      <DocumentEditor
        kind={editing}
        row={editing ? state.documents[editing] ?? null : null}
        onClose={() => setEditing(null)}
        onSaved={(row) => {
          setState({ ...state, documents: { ...state.documents, [row.kind]: row } });
          setEditing(null);
        }}
      />
    </div>
  );
}

/** Modal editor around today's `DocumentForm`; saving writes a new version through the documents route. */
export function DocumentEditor({
  kind,
  row,
  onClose,
  onSaved,
}: {
  kind: DocumentKind | null;
  row: DocumentRow | null;
  onClose: () => void;
  onSaved: (row: DocumentRow) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Body>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (kind) {
      setDraft(row ? structuredClone(row.body) : {});
      setError(null);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [kind, row]);

  async function save() {
    if (!kind) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api<DocumentRow>(`/cmo/documents/${kind}`, jsonBody({ body: draft }, "PUT")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} className="scr-dialog" aria-labelledby="scr-doc-title" onClose={onClose}>
      <div className="scr scr-dialog-body">
        {kind && (
          <>
            <div className="scr-dialog-head">
              <h2 id="scr-doc-title">{DOCUMENTS[kind].title}</h2>
              <Button variant="quiet" small onClick={onClose}>
                Close
              </Button>
            </div>
            <p className="scr-small scr-muted">
              Saving makes a new version; every department reads it from the next brief.
            </p>
            <DocumentForm fields={DOCUMENTS[kind].fields} value={draft} onChange={setDraft} idPrefix={`lib-${kind}`} />
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="scr-dialog-actions">
              <Button variant="primary" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
