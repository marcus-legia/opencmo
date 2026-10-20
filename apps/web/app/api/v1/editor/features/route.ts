import { withApi } from "@/lib/api/handler";
import { llmReady } from "@/lib/cmo/jobs/llm";
import { aiFakeEnabled, voiceEnabled } from "@/lib/generate/models";

export const dynamic = "force-dynamic";

/**
 * The editor's paid helpers this server can run, so the Inspector says so before a click instead of
 * failing after it. Captions run speech-to-text on the worker (same key as voice); translation is
 * the `captions` agent on whichever model provider has a key.
 */
export const GET = withApi({}, async () => ({
  captions: voiceEnabled() || aiFakeEnabled(),
  translate: llmReady("captions"),
}));
