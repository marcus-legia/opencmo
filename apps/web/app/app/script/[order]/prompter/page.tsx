import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Prompter } from "@/components/screens/script/Prompter";
import { ScriptBeatSchema } from "@/lib/cmo/writer/types";
import { requireUiV2 } from "@/lib/screens/flag";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prompter" };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The script on the founder's phone (cmo-review-3 I2, canvas Prompter.dc.html). Read-only, under the normal login and
 * RLS: an order of another founder reads as nothing and the page is a 404. No share link, no token. Nothing records
 * here; the founder films with the phone's camera app and uploads as today.
 */
export default async function PrompterPage({ params }: { params: Promise<{ order: string }> }) {
  requireUiV2();
  const { order } = await params;
  if (!UUID.test(order)) notFound();
  const supabase = await createServerClient();
  const { data } = await supabase.from("work_orders").select("id, title, brief").eq("id", order).maybeSingle<{ id: string; title: string | null; brief: { storyboard?: unknown } | null }>();
  const beats = z.array(ScriptBeatSchema).min(1).safeParse(data?.brief?.storyboard);
  if (!data || !beats.success) notFound();
  return <Prompter title={data.title ?? "Your script"} beats={beats.data} />;
}
