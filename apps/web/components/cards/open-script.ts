"use client";

import { api } from "@/components/clipping/api";

/** Opens an approved script's edit (its markers placed by the route) in the editor. Throws what the route refused. */
export async function openScript(orderId: string): Promise<void> {
  const { clipId } = await api<{ clipId: string }>(`/cmo/scripts/${encodeURIComponent(orderId)}/open`, { method: "POST" });
  window.location.assign(`/app/editor/${encodeURIComponent(clipId)}`);
}
