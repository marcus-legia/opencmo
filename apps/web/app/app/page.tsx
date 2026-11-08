import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CmoView } from "@/components/cmo/CmoView";
import { CmoWorkspace } from "@/components/cmo/workspace/CmoWorkspace";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { UI_V2 } from "@/lib/screens/flag";
import { loadWorkspace } from "@/lib/cmo/load-workspace";
import { loadCmoState } from "@/lib/cmo/state";
import { hasPlanOrCredits } from "@/lib/paid-first";
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
  const site = typeof params.site === "string" ? params.site.slice(0, 300) : "";
  const { data: { user } } = await supabase.auth.getUser();
  const state = await loadCmoState(supabase);
  const started = Object.keys(state.documents).length > 0;

  // Paid first, no free trial (owner, 2026-11-08): a new account with no plan and no credits picks a plan before the
  // CMO does any work. A founder who already started keeps the Dashboard and the drafts waiting there. `paid=1` is
  // Creem's return: the webhook may land after the founder does, and the onboarding route waits for it.
  if (!started && params.paid !== "1" && !(user && (await hasPlanOrCredits(supabase, user.id)))) {
    redirect(site ? `/app/billing?start=1&site=${encodeURIComponent(site)}` : "/app/billing?start=1");
  }

  // v2: a founder with no documents starts at Setup (S13), with the website they typed on the landing page; the
  // Dashboard reads its own data client-side.
  if (UI_V2) {
    if (Object.keys(state.documents).length === 0) {
      const query = new URLSearchParams({ ...(site ? { site } : {}), ...(params.paid === "1" ? { paid: "1" } : {}) }).toString();
      redirect(query ? `/app/setup?${query}` : "/app/setup");
    }
    return <Dashboard />;
  }

  if (Object.keys(state.documents).length === 0) return <CmoView initial={state} site={site} />;
  return <CmoWorkspace initial={await loadWorkspace(supabase)} />;
}

