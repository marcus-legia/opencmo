/**
 * The one place a CMO job asks a model: `structured()`, or the scripted stand-in on CI and e2e.
 */

import type { z } from "zod";

import { fakeAllowed, structured, type StructuredOptions } from "./llm";

export type ThinkOptions<S extends z.ZodType> = StructuredOptions<S> & {
  /** What the call is for, one line; documents the call site, never sent to the model. */
  title: string;
  /** CI/E2E stand-in for the model (`OPENCMO_AGENT_FAKE`). */
  fake?: () => z.infer<S>;
};

export async function think<S extends z.ZodType>(opts: ThinkOptions<S>): Promise<z.infer<S>> {
  if (opts.fake && fakeAllowed()) return opts.fake();
  return structured(opts);
}
