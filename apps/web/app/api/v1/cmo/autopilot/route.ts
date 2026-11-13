import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { firstRow, rpcOrThrow, withApi } from "@/lib/api/handler";
import { AUTOPILOT_HOURS, AUTOPILOT_PLATFORMS, type Autopilot } from "@/lib/screens/settings";

export const dynamic = "force-dynamic";

type Row = { autopilot_platforms: string[]; autopilot_hours: number; autopilot_note: string | null; autopilot_paused?: boolean };

const LIMIT = { bucket: "presets", limit: 60, windowSeconds: 3600 } as const;

const toAutopilot = (row: Row, paused: boolean): Autopilot => ({
  platforms: AUTOPILOT_PLATFORMS.filter((id) => row.autopilot_platforms.includes(id)),
  hours: AUTOPILOT_HOURS.find((h) => h === row.autopilot_hours) ?? 12,
  note: row.autopilot_note,
  paused,
});

const body = z.object({
  platforms: z.array(z.enum(AUTOPILOT_PLATFORMS)).max(AUTOPILOT_PLATFORMS.length),
  hours: z.union(AUTOPILOT_HOURS.map((h) => z.literal(h))),
});

/**
 * Autopilot (owner, 2026-11-12): the platforms whose posts go out without the founder's Approve, and the hours they
 * have to change one first. `save_autopilot` holds the rules: a paid plan, a connected account, posts only. Choosing
 * platforms leaves the top bar's off switch as it is.
 */
export const PUT = withApi({ body, rateLimit: LIMIT }, async ({ supabase, body, user }) => {
  const row = firstRow(await rpcOrThrow<Row | Row[]>(supabase, "save_autopilot", { p_platforms: body.platforms, p_hours: body.hours }));
  if (!row) throw new ApiError(500, "Could not save your settings.");
  const { data } = await supabase.from("profiles").select("autopilot_paused").eq("id", user.id).maybeSingle<{ autopilot_paused: boolean }>();
  return toAutopilot(row, data?.autopilot_paused === true);
});

const switchBody = z.object({ paused: z.boolean() });

/**
 * The top bar's switch (owner, 2026-11-13): off stops every countdown at once and keeps the platforms; on, new drafts
 * count down again. `set_autopilot_paused` asks no plan: turning something off is never refused.
 */
export const PATCH = withApi({ body: switchBody, rateLimit: LIMIT }, async ({ supabase, body }) => {
  const row = firstRow(await rpcOrThrow<Row | Row[]>(supabase, "set_autopilot_paused", { p_paused: body.paused }));
  if (!row) throw new ApiError(500, "Could not change autopilot.");
  return toAutopilot(row, row.autopilot_paused === true);
});
