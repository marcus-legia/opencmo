import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CmoView } from "@/components/cmo/CmoView";
import { CmoWorkspace } from "@/components/cmo/workspace/CmoWorkspace";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { UI_V2 } from "@/components/ui/flag";
import { loadWorkspace } from "@/lib/cmo/load-workspace";
import { loadCmoState } from "@/lib/cmo/state";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI CMO" };

type Params = { site?: string; url?: string; source?: string; count?: string; length?: string };

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

  // v2: the Dashboard reads its own data client-side; first-run setup moves to /app/setup (Session C, U8).
  if (UI_V2) return <Dashboard />;

  const supabase = await createServerClient();
  const site = typeof params.site === "string" ? params.site.slice(0, 300) : "";
  const state = await loadCmoState(supabase);
  if (Object.keys(state.documents).length === 0) return <CmoView initial={state} site={site} />;
  return <CmoWorkspace initial={await loadWorkspace(supabase)} />;
}
