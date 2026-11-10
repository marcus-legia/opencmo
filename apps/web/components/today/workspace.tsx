"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { api } from "@/components/clipping/api";
import type { DocumentKind } from "@/lib/cmo/documents";
import type { CmoState } from "@/lib/cmo/state";

export type ConnectedAccount = { platform: string; handle: string };

/** What the top bar and the Context column show about the business, read once per session. */
export type Workspace = {
  ready: boolean;
  name: string | null;
  category: string | null;
  site: string | null;
  summary: string | null;
  competitors: { name: string; website: string }[];
  /** Document kinds that exist, with when they were last written. */
  documents: Partial<Record<DocumentKind, { at: string; by: "agent" | "user" }>>;
  accounts: ConnectedAccount[];
  reload: () => void;
};

const EMPTY: Workspace = { ready: false, name: null, category: null, site: null, summary: null, competitors: [], documents: {}, accounts: [], reload: () => {} };

const WorkspaceContext = createContext<Workspace>(EMPTY);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** `https://www.xpush.app/` → `xpush.app`: the chip shows the site the way a founder says it. */
export function siteLabel(site: string | null): string | null {
  if (!site) return null;
  return site.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "") || null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Workspace>(EMPTY);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<CmoState>("/cmo/documents").catch(() => null),
      api<{ accounts?: ConnectedAccount[] }>("/accounts").catch(() => null),
    ]).then(([docs, accounts]) => {
      if (!alive) return;
      const product = (docs?.documents.product?.body ?? {}) as Record<string, unknown>;
      const rivals = (docs?.documents.competitors?.body?.competitors ?? []) as unknown[];
      const documents: Workspace["documents"] = {};
      for (const [kind, row] of Object.entries(docs?.documents ?? {})) {
        if (row) documents[kind as DocumentKind] = { at: row.created_at, by: row.created_by };
      }
      setState({
        ready: true,
        name: text(product.name),
        category: text(product.category),
        site: text(docs?.lastRun?.input.site),
        summary: text(product.description) ?? text(product.one_liner),
        competitors: rivals
          .map((c) => c as Record<string, unknown>)
          .filter((c) => text(c.name))
          .map((c) => ({ name: text(c.name)!, website: text(c.website) ?? "" })),
        documents,
        accounts: accounts?.accounts ?? [],
        reload: () => setVersion((n) => n + 1),
      });
    });
    return () => {
      alive = false;
    };
  }, [version]);

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  return useContext(WorkspaceContext);
}
