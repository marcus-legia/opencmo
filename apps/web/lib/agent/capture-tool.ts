/**
 * Page captures for proof B-roll (docs/style-skills-build.md): the Assistant captures a public page
 * the speaker cites, waits for it, and `add_proof` places it. Capturing runs on the worker in a
 * sandbox with no secrets (Track C); here the Assistant only asks for one and reads its status, under
 * the user's RLS.
 *
 * The tools are offered only once `proof.capture` is ready in the capability registry.
 */

import { z } from "zod";

import { isReady } from "@opencmo/editor-core/capabilities";

import { ApiError } from "@/lib/api/errors";
import type { SupabaseClient } from "@/lib/api/handler";
import { createCapture } from "@/lib/capture";

import { readCaptureState } from "./captures";
import { spec, type ToolOutcome, type ToolSpec } from "./tools";

export const captureInput = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .url("Give the full address, like https://github.com/owner/repo.")
    .refine((url) => /^https?:\/\//i.test(url), "Only http and https pages can be captured.")
    .describe("The public page the speaker cites, e.g. a GitHub repository."),
});
export const captureStatusInput = z.object({ capture_id: z.string().uuid() });

export const CAPTURE_TOOLS = new Set(["capture_page", "capture_status"]);

/** Tool specs, or none while page capture is not ready. New tools go at the end of the clip scope's list. */
export function captureToolSpecs(): ToolSpec[] {
  if (!isReady("proof.capture")) return [];
  return [
    spec(
      "capture_page",
      "Capture a public web page (a screenshot plus the text on it) to show as proof on the clip: the page the speaker cites for a number, a repo or a title. Free, up to 30 a day; the same page within 24 h comes back from the cache. Returns capture_id; wait with capture_status until it is ready before using it in apply_style.",
      captureInput,
    ),
    spec("capture_status", "Check a page capture from capture_page: pending, ready, or failed with the reason.", captureStatusInput),
  ];
}

const invalid = (message: string, summary: string): ToolOutcome => ({ ok: false, content: JSON.stringify({ INVALID_INPUT: message }), summary });

export async function runCaptureTool(supabase: SupabaseClient, call: { name: string; input: unknown }): Promise<ToolOutcome> {
  if (call.name === "capture_page") {
    const parsed = captureInput.safeParse(call.input);
    if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid address.", "Could not capture the page");
    let created: { capture_id: string; status: string };
    try {
      // Same path as the route: the RPC, then a wake so the capture starts now, not at the next sweep.
      created = await createCapture(supabase, parsed.data.url);
    } catch (err) {
      // The RPC's refusals (address not allowed, daily limit) are written for the user.
      const message = err instanceof ApiError ? err.message : "The page could not be captured. Please try again.";
      return { ok: false, content: JSON.stringify({ error: message }), summary: "Page not captured" };
    }
    return { ok: true, content: JSON.stringify(created), summary: `Capturing ${new URL(parsed.data.url).hostname}` };
  }
  const parsed = captureStatusInput.safeParse(call.input);
  if (!parsed.success) return invalid("capture_id is the id capture_page returned.", "Unknown capture");
  const state = await readCaptureState(supabase, parsed.data.capture_id);
  if (!state) return { ok: false, content: JSON.stringify({ error: "There is no capture with that id." }), summary: "Unknown capture" };
  const summary = state.status === "ready" ? "Page capture ready" : state.status === "failed" ? "Page capture failed" : "Page capture in progress";
  return { ok: true, content: JSON.stringify({ capture_id: parsed.data.capture_id, ...state }), summary };
}
