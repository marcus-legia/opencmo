import "server-only";

/**
 * The CMO agent registry (H1): EVERY job is an agent with its own model and key, so an agent can
 * be swapped per task without code changes. Configured with env on Vercel (no UI, keys stay out of
 * the database):
 *
 *   CMO_LLM_PROVIDERS       = openai,anthropic,gemini  (the order agents try providers in; this order when unset)
 *   CMO_LLM_PROVIDER        = anthropic | gemini | openai | groq  (default for every agent; when unset, the
 *                             first provider of the order the server has a key for)
 *   CMO_AGENT_<ID>_PROVIDER = the same, for one agent
 *   CMO_AGENT_<ID>_MODEL    = a model id of that provider
 *   CMO_AGENT_<ID>_API_KEY  = the agent's own key; defaults to the provider's shared key
 *                             (ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_COMPAT_API_KEY or GROQ_API_KEY)
 *   CMO_AGENT_<ID>_BASE_URL = openai only: the agent's own endpoint
 *
 * `openai` is any OpenAI-compatible chat API (Groq, OpenRouter, Together, DeepSeek, Ollama…):
 * OPENAI_COMPAT_BASE_URL (Groq when unset), OPENAI_COMPAT_MODEL and OPENAI_COMPAT_CHECK_MODEL for
 * the two tiers. `groq` is a spelling of `openai` on Groq's endpoint. Moving every agent to another
 * vendor is env only (docs/plans/editor/2026-10-20-editor-mcp-providers-plan.md, item 2).
 *
 * `<ID>` in capitals: CMO, ONBOARDING, PLANNER, X_WRITER, SALES, RESEARCH, VIDEO, CHECKER, CAPTIONS,
 * WRITER, MOTION, DIRECTOR, MODERATION.
 * Two tiers: drafting agents use the big model (Sonnet, Gemini Pro), checking agents the small one (Haiku, Gemini
 * Flash) — a check does not need deep reasoning, and a separate context keeps the checker from being persuaded by
 * the draft.
 */

export type AgentId = "cmo" | "onboarding" | "planner" | "x_writer" | "sales" | "research" | "video" | "checker" | "captions" | "writer" | "motion" | "director" | "moderation";
export type ProviderKind = "anthropic" | "gemini" | "openai";

export const PROVIDER_KINDS: readonly ProviderKind[] = ["openai", "anthropic", "gemini"];

/** Groq's OpenAI-compatible endpoint: the default for `openai`. */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export type AgentSpec = {
  id: AgentId;
  /** Tên hiện trong log/Activity (tiếng Anh: có thể lên UI). */
  label: string;
  /** Việc của agent — dùng trong prompt CMO khi giao việc. */
  role: string;
  tier: "draft" | "check";
};

export const AGENT_SPECS: Record<AgentId, AgentSpec> = {
  cmo: { id: "cmo", label: "CMO", role: "Talks with the founder, researches with social tools, and hands tasks to the other agents.", tier: "draft" },
  onboarding: { id: "onboarding", label: "Onboarding", role: "Reads the website and drafts the four marketing documents.", tier: "draft" },
  planner: { id: "planner", label: "Planner", role: "Plans the week of posts, Reddit replies and short videos.", tier: "draft" },
  x_writer: { id: "x_writer", label: "X writer", role: "Drafts X posts for the founder to approve and post.", tier: "draft" },
  sales: { id: "sales", label: "Sales", role: "Finds Reddit threads where people need the product and drafts helpful replies.", tier: "draft" },
  research: { id: "research", label: "Research", role: "Finds competitor and niche posts that outperform, and why they worked.", tier: "draft" },
  video: { id: "video", label: "Video", role: "Writes captions for clips cut from the founder's own videos.", tier: "draft" },
  checker: { id: "checker", label: "Checker", role: "Reviews drafts and scores threads in a separate context.", tier: "check" },
  captions: { id: "captions", label: "Captions", role: "Translates captions in the editor.", tier: "check" },
  writer: { id: "writer", label: "Writer", role: "Writes the on-screen words of an intro or title card for a clip.", tier: "check" },
  motion: { id: "motion", label: "Motion director", role: "Plans the beats, timing and easing of an animated intro.", tier: "draft" },
  director: { id: "director", label: "Director", role: "Writes the script and shot list of an AI video from a prompt.", tier: "draft" },
  moderation: { id: "moderation", label: "Moderation", role: "Checks prompts for AI media against the product rules.", tier: "check" },
};

export const AGENT_IDS = Object.keys(AGENT_SPECS) as AgentId[];

function defaultModel(provider: ProviderKind, tier: AgentSpec["tier"], env: NodeJS.ProcessEnv): string {
  if (provider === "gemini") return tier === "check" ? "gemini-flash-latest" : "gemini-pro-latest";
  // Groq's ids at the time of writing; set the env to whatever `GET /models` lists on the endpoint.
  if (provider === "openai") return tier === "check" ? env.OPENAI_COMPAT_CHECK_MODEL?.trim() || "openai/gpt-oss-20b" : env.OPENAI_COMPAT_MODEL?.trim() || "openai/gpt-oss-120b";
  return tier === "check" ? "claude-haiku-5-5" : "claude-sonnet-5-5";
}

const sharedKey = (provider: ProviderKind, env: NodeJS.ProcessEnv): string => {
  if (provider === "gemini") return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  if (provider === "openai") return env.OPENAI_COMPAT_API_KEY || env.GROQ_API_KEY || "";
  return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || "";
};

/** A provider name from env, or null. `groq` is `openai` on Groq's endpoint. */
function parseKind(value: string | undefined): ProviderKind | null {
  const name = value?.trim().toLowerCase();
  if (name === "groq") return "openai";
  return (PROVIDER_KINDS as readonly string[]).includes(name ?? "") ? (name as ProviderKind) : null;
}

/** The order agents try providers in: CMO_LLM_PROVIDERS, then any provider it leaves out. */
export function providerOrder(env: NodeJS.ProcessEnv = process.env): ProviderKind[] {
  const listed = (env.CMO_LLM_PROVIDERS ?? "").split(",").map(parseKind).filter((kind): kind is ProviderKind => kind !== null);
  return [...new Set([...listed, ...PROVIDER_KINDS])];
}

/** `openai`'s endpoint for one agent, without a trailing slash; empty for the other providers. */
function baseUrl(provider: ProviderKind, prefix: string, env: NodeJS.ProcessEnv, own: boolean): string {
  if (provider !== "openai") return "";
  const url = (own ? env[`${prefix}BASE_URL`]?.trim() : "") || env.OPENAI_COMPAT_BASE_URL?.trim() || GROQ_BASE_URL;
  return url.replace(/\/+$/, "");
}

/** `ownKey`: the agent runs on a key of its own, not the provider's shared key. */
export type ResolvedAgent = AgentSpec & { provider: ProviderKind; model: string; apiKey: string; baseUrl: string; ownKey: boolean; source: "env" | "default" };

/**
 * An agent's real model and key. An empty `apiKey` means the agent is not set up (no key); the
 * caller reports that in English. Keys never leave the server.
 */
export function resolveAgent(id: AgentId, env: NodeJS.ProcessEnv = process.env, fallback?: ProviderKind): ResolvedAgent {
  const spec = AGENT_SPECS[id];
  const prefix = `CMO_AGENT_${id.toUpperCase()}_`;
  // The agent as ANOTHER provider would run it (failover): that provider's model of the same
  // tier and its shared key. The agent's own MODEL, API_KEY and BASE_URL belong to its configured provider.
  if (fallback) {
    return { ...spec, provider: fallback, model: defaultModel(fallback, spec.tier, env), apiKey: sharedKey(fallback, env), baseUrl: baseUrl(fallback, prefix, env, false), ownKey: false, source: "default" };
  }
  const ownName = env[`${prefix}PROVIDER`]?.trim();
  const named = ownName || env.CMO_LLM_PROVIDER?.trim();
  const wanted = parseKind(named);
  if (named && !wanted) console.error(`[cmo] ${ownName ? `${prefix}PROVIDER` : "CMO_LLM_PROVIDER"}="${named}" is not a provider; using the provider order`);
  // Nothing named: the first provider of the order with a shared key (Claude when there is none).
  const provider: ProviderKind = wanted ?? providerOrder(env).find((kind) => sharedKey(kind, env)) ?? "anthropic";
  const model = env[`${prefix}MODEL`]?.trim() || defaultModel(provider, spec.tier, env);
  const apiKey = env[`${prefix}API_KEY`]?.trim() || sharedKey(provider, env);
  const source = wanted || env[`${prefix}MODEL`] || env[`${prefix}API_KEY`] ? "env" : "default";
  return { ...spec, provider, model, apiKey, baseUrl: baseUrl(provider, prefix, env, true), ownKey: Boolean(env[`${prefix}API_KEY`]?.trim()), source };
}

/**
 * Every way the server can run the agent, in the order to try: `first` (the configured provider
 * when unset), then the other providers of the order on their shared keys. Only those with a key.
 */
export function agentCandidates(id: AgentId, env: NodeJS.ProcessEnv = process.env, first?: ProviderKind): ResolvedAgent[] {
  const lead = first ? resolveAgent(id, env, first) : resolveAgent(id, env);
  const rest = providerOrder(env).filter((kind) => kind !== lead.provider).map((kind) => resolveAgent(id, env, kind));
  return [lead, ...rest].filter((agent) => agent.apiKey);
}

/**
 * A provider other than `drafter` with a key, for a judge that must not grade its own provider. With
 * no such key, Claude or Gemini: `agentCandidates` drops it and the judge runs on the drafter's
 * provider in a separate context.
 */
export function otherProvider(drafter: string, env: NodeJS.ProcessEnv = process.env): ProviderKind {
  return providerOrder(env).find((kind) => kind !== drafter && sharedKey(kind, env)) ?? (drafter === "anthropic" ? "gemini" : "anthropic");
}

/** Current configuration without keys — for the startup log and the internal diagnostics page. */
export function agentTable(env: NodeJS.ProcessEnv = process.env): { id: AgentId; provider: ProviderKind; model: string; ready: boolean; source: string }[] {
  return AGENT_IDS.map((id) => {
    const agent = resolveAgent(id, env);
    return { id, provider: agent.provider, model: agent.model, ready: Boolean(agent.apiKey), source: agent.source };
  });
}
