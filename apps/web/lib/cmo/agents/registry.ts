import "server-only";

/**
 * The CMO agent registry (H1): EVERY job is an agent with its own model and key, so an agent can
 * be swapped per task without code changes. Every agent runs on Claude (owner, 2026-11-05: one
 * provider; Gemini and Groq were removed). Configured with env on Vercel (no UI, keys stay out of
 * the database):
 *
 *   CMO_AGENT_<ID>_MODEL    = a Claude model id for one agent
 *   CMO_AGENT_<ID>_API_KEY  = the agent's own Anthropic key; defaults to ANTHROPIC_API_KEY
 *
 * `<ID>` in capitals: CMO, ONBOARDING, PLANNER, X_WRITER, THREADS_WRITER, LINKEDIN_WRITER, FACEBOOK_WRITER, INSTAGRAM_WRITER,
 * TIKTOK_WRITER, YOUTUBE_WRITER, BRIEF_WRITER, SLIDES_WRITER, SALES, RESEARCH, CHECKER, CAPTIONS, WRITER, MOTION,
 * DIRECTOR, MODERATION, SHORTS.
 * Two tiers: drafting agents (copy, scripts, plans) use Sonnet, small tasks (checks, translation, picks) use Haiku.
 * The checker runs in a separate context, so it is not persuaded by the draft it grades.
 */

export type AgentId = "cmo" | "onboarding" | "planner" | "x_writer" | "threads_writer" | "linkedin_writer" | "facebook_writer" | "instagram_writer" | "tiktok_writer" | "youtube_writer" | "brief_writer" | "sales" | "research" | "checker" | "captions" | "writer" | "motion" | "director" | "moderation" | "shorts";
export type ProviderKind = "anthropic";

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
  threads_writer: { id: "threads_writer", label: "Threads writer", role: "Drafts Threads posts for the founder to approve and post.", tier: "draft" },
  linkedin_writer: { id: "linkedin_writer", label: "LinkedIn writer", role: "Drafts LinkedIn posts for the founder to approve and post.", tier: "draft" },
  facebook_writer: { id: "facebook_writer", label: "Facebook writer", role: "Drafts Facebook Page posts for the founder to approve and post.", tier: "draft" },
  instagram_writer: { id: "instagram_writer", label: "Instagram writer", role: "Writes the Instagram caption of the founder's finished video or short.", tier: "draft" },
  tiktok_writer: { id: "tiktok_writer", label: "TikTok writer", role: "Writes the TikTok caption of the founder's finished video or short.", tier: "draft" },
  youtube_writer: { id: "youtube_writer", label: "YouTube writer", role: "Writes the YouTube title and description of the founder's finished video.", tier: "draft" },
  brief_writer: { id: "brief_writer", label: "Brief writer", role: "Writes the brief the video team makes a video from: angle, three hooks, key points, call to action.", tier: "draft" },
  sales: { id: "sales", label: "Sales", role: "Finds Reddit threads where people need the product and drafts helpful replies.", tier: "draft" },
  research: { id: "research", label: "Research", role: "Finds competitor and niche posts that outperform, and why they worked.", tier: "draft" },
  checker: { id: "checker", label: "Checker", role: "Reviews drafts and scores threads in a separate context.", tier: "check" },
  captions: { id: "captions", label: "Captions", role: "Translates captions in the editor.", tier: "check" },
  writer: { id: "writer", label: "Writer", role: "Writes the on-screen words of an intro or title card for a clip.", tier: "check" },
  motion: { id: "motion", label: "Motion director", role: "Plans the beats, timing and easing of an animated intro.", tier: "draft" },
  director: { id: "director", label: "Director", role: "Writes the script and shot list of an AI video from a prompt.", tier: "draft" },
  moderation: { id: "moderation", label: "Moderation", role: "Checks prompts for AI media against the product rules.", tier: "check" },
  shorts: { id: "shorts", label: "Clip editor", role: "Picks the three best short clips of a finished video, hook first.", tier: "check" },
};

export const AGENT_IDS = Object.keys(AGENT_SPECS) as AgentId[];

/**
 * The writer agent for each post profile of `packages/contracts/platforms.json` (P3 W1). Each can run on its own
 * model and key; all of them send the same system prompt, so the prompt cache serves every platform.
 */
export const POST_WRITERS: Readonly<Record<string, AgentId>> = { x: "x_writer", threads: "threads_writer", linkedin: "linkedin_writer", facebook: "facebook_writer" };

/** The writer agent for each caption profile (P3 W3); same idea as `POST_WRITERS`: one prefix per kind, many agents. */
export const CAPTION_WRITERS: Readonly<Record<string, AgentId>> = { instagram_caption: "instagram_writer", tiktok_caption: "tiktok_writer", youtube: "youtube_writer" };

const defaultModel = (tier: AgentSpec["tier"]): string => (tier === "check" ? "claude-haiku-5-5" : "claude-sonnet-5-5");

const sharedKey = (env: NodeJS.ProcessEnv): string => env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || "";

/** `ownKey`: the agent runs on a key of its own, not the shared ANTHROPIC_API_KEY. */
export type ResolvedAgent = AgentSpec & { provider: ProviderKind; model: string; apiKey: string; ownKey: boolean; source: "env" | "default" };

/**
 * An agent's real model and key. An empty `apiKey` means the agent is not set up (no key); the
 * caller reports that in English. Keys never leave the server.
 */
export function resolveAgent(id: AgentId, env: NodeJS.ProcessEnv = process.env): ResolvedAgent {
  const spec = AGENT_SPECS[id];
  const prefix = `CMO_AGENT_${id.toUpperCase()}_`;
  const ownModel = env[`${prefix}MODEL`]?.trim();
  const ownKey = env[`${prefix}API_KEY`]?.trim();
  return {
    ...spec,
    provider: "anthropic",
    model: ownModel || defaultModel(spec.tier),
    apiKey: ownKey || sharedKey(env),
    ownKey: Boolean(ownKey),
    source: ownModel || ownKey ? "env" : "default",
  };
}

/** The agent when the server has a key for it, as a list for `withFailover`; empty when it is not set up. */
export function agentCandidates(id: AgentId, env: NodeJS.ProcessEnv = process.env): ResolvedAgent[] {
  const agent = resolveAgent(id, env);
  return agent.apiKey ? [agent] : [];
}

/** Current configuration without keys — for the startup log and the internal diagnostics page. */
export function agentTable(env: NodeJS.ProcessEnv = process.env): { id: AgentId; provider: ProviderKind; model: string; ready: boolean; source: string }[] {
  return AGENT_IDS.map((id) => {
    const agent = resolveAgent(id, env);
    return { id, provider: agent.provider, model: agent.model, ready: Boolean(agent.apiKey), source: agent.source };
  });
}
