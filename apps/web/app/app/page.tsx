import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CmoView } from "@/components/cmo/CmoView";
import { CmoWorkspace } from "@/components/cmo/workspace/CmoWorkspace";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { UI_V2 } from "@/lib/screens/flag";
import { loadWorkspace } from "@/lib/cmo/load-workspace";
import { loadCmoState } from "@/lib/cmo/state";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI CMO" };

type Params = { site?: string; url?: string; source?: string; count?: string; length?: string; paid?: string };

/**
 * The home page after sign-in = AI CMO. Without documents it is onboarding (enter a website);
 * with them, the 4-column workspace.
 *
 * Old clip-making links (`/app?url=…`, `?source=upload`) land on the editor's Upload tab. A link
 * is never imported, so `url` is dropped.
 */
export default async function CmoHome({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  if (params.url || params.source || params.count || params.length) {
    redirect("/app/editor?panel=upload");
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const site = typeof params.site === "string" ? params.site.slice(0, 300) : "";
  const state = await loadCmoState(supabase);
  const started = Object.keys(state.documents).length > 0;

  // The first run is free (CMO review 3, 3.1, replacing "paid first" of 2026-11-08): a new account goes to Setup and
  // gets its documents, its first week and its first drafts before any plan. The paywall answers the first action that
  // sends something out or costs credits again (`cmo_require_paid`). `paid=1` is Creem's return, which anyone can type:
  // Setup says the payment arrived only when the plan or credits are there, and that it is on its way otherwise.
  if (UI_V2) {
    if (!started) {
      const paid = params.paid === "1" ? ((await supabase.rpc("cmo_require_paid", { p_user: user?.id ?? null })).error ? "pending" : "1") : null;
      const query = new URLSearchParams({ ...(site ? { site } : {}), ...(paid ? { paid } : {}) }).toString();
      redirect(query ? `/app/setup?${query}` : "/app/setup");
    }
    return <Dashboard />;
  }

  if (Object.keys(state.documents).length === 0) return <CmoView initial={state} site={site} />;
  return <CmoWorkspace initial={await loadWorkspace(supabase)} />;
}

