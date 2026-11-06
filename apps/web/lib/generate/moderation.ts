/**
 * Screens the TEXT that goes into a media model, as the payment provider requires (product rule 4).
 *
 * Moderation is Creem's (owner decision D8, 2026-11-05): every image and video prompt goes through Creem's Moderation
 * API, and we write no policy of our own and run no LLM check on prompts. This runs in `createGeneration` (the one
 * path of the Generate panel, the Assistant and MCP) BEFORE credits are held, so a blocked request costs nothing.
 * Voice, music and sound prompts are not screened: Creem does not require it, and voices stay premade (no cloning,
 * dubbing or lip-sync). What a model draws is reviewed on the worker before the user gets it
 * (`opencmo/ai/moderation.py`, against `packages/contracts/creem-policy.json`). If Creem cannot answer, the
 * request is refused: a user retrying beats delivering something unscreened.
 */

import { ApiError } from "@/lib/api/errors";
import { creemApiBase } from "@/lib/creem";
import { agentCandidates } from "@/lib/cmo/agents/registry";

import { aiFakeEnabled } from "./models";
import { isProduction } from "@/lib/production";

/** Fake mode: text containing this mark is blocked — tests the refusal path without the network. */
export const FAKE_FLAG = "[[flag]]";
const MAX_CHARS = 8000;

export const BLOCKED_MESSAGE = "This request goes against our content policy. Change it and try again.";
const UNCHECKED_MESSAGE = "Could not check this request. Please try again.";

/**
 * The review of finished media can run: the worker looks at every image and video with Claude (vision) before the
 * user gets it. Production enables AI images and video only with this and a live Creem key (`allowedHere`).
 */
export const moderationReady = (env: NodeJS.ProcessEnv = process.env): boolean => agentCandidates("moderation", env).length > 0;

const AUDIO_KINDS = new Set(["audio", "voice"]);
/** The kind `moderateText` takes for our own renderer's text (explainers, motion clips): screened like a video prompt. */
export const MOTION_KIND = "motion";

/** The kind to screen a model's text as: our own renderer's text is on-screen copy, still screened by Creem. */
export const moderationKind = (model: { kind: string; provider: string }): string =>
  model.provider === "opencmo-motion" ? MOTION_KIND : model.kind;

/** Every user-written string in a spec (prompt, 3D scene text, voice script…), without identifiers. */
export function specText(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    if (/^(code_ref|model|voice|aspectRatio|theme|template|resolution|quality|after|startAfter|endAfter)$/.test(key)) return [];
    return value.trim().length > 1 ? [value.trim()] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => specText(item, key));
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => specText(v, k));
  return [];
}

const CREEM_TIMEOUT_MS = 5_000;

/** The Creem key this server may screen with. Live, a test key does not count: Creem's review only sees live calls. */
export const creemModerationKey = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const key = env.CREEM_API_KEY?.trim();
  if (!key) return null;
  const live = env.VERCEL_ENV === "production" || env.OPENCMO_ENV === "production";
  return live && key.startsWith("creem_test_") ? null : key;
};

/**
 * Creem's screening, which it requires of AI generation products: an account without it can be suspended and its
 * funds held. It fails closed. `flag` blocks like `deny`, as Creem recommends. `fetcher` stands in for the network in
 * checks.
 */
async function screenWithCreem(input: string, externalId: string | undefined, fetcher: typeof fetch): Promise<void> {
  const apiKey = creemModerationKey();
  if (!apiKey) {
    if (isProduction()) throw new ApiError(503, "Content checks are not set up on this server, so AI media cannot be created yet.");
    return;
  }
  let decision: unknown;
  try {
    const response = await fetcher(`${creemApiBase(apiKey)}/v1/moderation/prompt`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ prompt: input, ...(externalId ? { external_id: externalId } : {}) }),
      signal: AbortSignal.timeout(CREEM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    decision = ((await response.json()) as { decision?: unknown } | null)?.decision;
  } catch (error) {
    console.error("[moderation] creem could not answer", error instanceof Error ? error.message : "");
    throw new ApiError(503, UNCHECKED_MESSAGE);
  }
  if (decision === "flag" || decision === "deny") throw new ApiError(422, BLOCKED_MESSAGE);
  if (decision !== "allow") {
    console.error("[moderation] creem gave an unknown decision");
    throw new ApiError(503, UNCHECKED_MESSAGE);
  }
}

/**
 * Throws 422 when Creem blocks the text, 503 when it could not be screened. Skipped without a Creem key outside
 * production (fake mode blocks `FAKE_FLAG` instead). `kind` is the model kind the text goes to; audio is not
 * screened. `externalId` ties Creem's record to our work, for audits.
 */
export async function moderateText(
  text: string,
  { kind, externalId, fetcher = fetch }: { kind?: string; externalId?: string; fetcher?: typeof fetch } = {},
): Promise<void> {
  const input = text.slice(0, MAX_CHARS).trim();
  if (!input) return;
  if (kind && AUDIO_KINDS.has(kind)) return;
  if (!creemModerationKey() && aiFakeEnabled()) {
    if (input.includes(FAKE_FLAG)) throw new ApiError(422, BLOCKED_MESSAGE);
    return;
  }
  await screenWithCreem(input, externalId, fetcher);
}
