/**
 * One live row per paid provider for the owner's Costs page (cmo-review-2 S3.1).
 *
 * On 2026-11-08 production ran on an Anthropic key that answered 401, and nothing in the app said so: `switches.ts`
 * only knows whether a variable is set. Each row here makes the cheapest authenticated call the provider offers, on the
 * server, and keeps the answer for a few minutes so a page reload does not call again. The key never leaves this
 * module: a row carries a state and a sentence, never the key or the provider's body.
 *
 * The outage memory of `lib/llm-health.ts` is read too: a key that failed on a real call in the last minutes is shown
 * as failing even when the cached check is older.
 */
import { accountDown } from "@/lib/llm-health";

export type ProviderState = "unset" | "invalid" | "test_key" | "unreachable" | "ok";

export type ProviderRow = {
  id: "anthropic" | "fal" | "elevenlabs" | "motion" | "creem" | "scrapecreators";
  label: string;
  state: ProviderState;
  /** What the state means, or what to set. Never a secret value. */
  detail: string;
};

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

const TIMEOUT_MS = 5_000;
export const CACHE_MS = 5 * 60_000;

/** A sentence Creem's screening allows: the check must not leave a flagged record on the account Creem reviews. */
export const CREEM_SAFE_PROMPT = "A cup of coffee on a wooden desk next to a laptop, morning light.";

const value = (env: Env, ...names: string[]): string => names.map((name) => env[name]?.trim() ?? "").find(Boolean) ?? "";
const live = (env: Env) => env.VERCEL_ENV === "production" || env.OPENCMO_ENV === "production";

type Probe = { url: string; init: RequestInit };
/** `invalid` for an answer that says the key is wrong; null when the answer says the key works. */
type Judge = (status: number, body: string) => "invalid" | null;

const authFailed: Judge = (status) => (status === 401 || status === 403 ? "invalid" : null);

async function probe(fetcher: Fetcher, { url, init }: Probe, judge: Judge): Promise<{ state: ProviderState; status?: number }> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { state: "unreachable" };
  }
  const body = response.ok ? "" : (await response.text().catch(() => "")).slice(0, 2_000);
  if (judge(response.status, body) === "invalid") return { state: "invalid", status: response.status };
  // Any other answer below 500 came from a provider that knows the key (a missing scope, a rate limit).
  return { state: response.status < 500 ? "ok" : "unreachable", status: response.status };
}

type Spec = {
  id: ProviderRow["id"];
  label: string;
  /** The key, or "" when unset. */
  key: (env: Env) => string;
  unset: string;
  /** No probe: the row is judged from the configuration alone. */
  probe?: (key: string, env: Env) => Probe;
  judge?: Judge;
  /** A key that works but must not be used here (a test key in production). */
  testKey?: (key: string, env: Env) => string | null;
  /** A 2xx or a 4xx the judge did not call invalid. */
  okDetail?: (status: number | undefined) => string;
};

const SPECS: Spec[] = [
  {
    id: "anthropic",
    label: "Anthropic (every agent and the CMO chat)",
    key: (env) => value(env, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    unset: "Set ANTHROPIC_API_KEY. Without it no agent can answer.",
    probe: (key, env) => ({
      url: "https://api.anthropic.com/v1/models?limit=1",
      init: {
        headers: {
          ...(value(env, "ANTHROPIC_API_KEY") ? { "x-api-key": key } : { authorization: `Bearer ${key}` }),
          "anthropic-version": "2023-06-01",
        },
      },
    }),
    judge: authFailed,
  },
  {
    id: "fal",
    label: "fal (AI images and video, the output review)",
    key: (env) => value(env, "FAL_KEY"),
    unset: "Set FAL_KEY here, in the Modal secret fal-secret and in opencmo-mcp. Without it AI images and video stay off.",
    // Billing is free to read. A key without the Admin scope gets 403 with a known key: only 401 means a wrong key.
    probe: (key) => ({ url: "https://api.fal.ai/v1/account/billing", init: { headers: { authorization: `Key ${key}` } } }),
    judge: (status) => (status === 401 ? "invalid" : null),
    okDetail: (status) => (status === 403 ? "The key is accepted (it has no Admin scope, so the balance is not shown)." : "The key is accepted."),
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs (voice-over, transcripts)",
    key: (env) => value(env, "ELEVENLABS_API_KEY"),
    unset: "Set ELEVENLABS_API_KEY here and in the Modal secret opencmo-voice. Without it uploads get no transcript.",
    probe: (key) => ({ url: "https://api.elevenlabs.io/v1/user/subscription", init: { headers: { "xi-api-key": key } } }),
    // A restricted key without the user_read permission answers 401 missing_permissions: the key itself is known.
    judge: (status, body) => (status === 401 && !/missing_permissions/i.test(body) ? "invalid" : null),
  },
  {
    id: "motion",
    label: "Motion renderer (explainers, slideshows)",
    // No live call: the preview endpoint runs scene code, and a call that renders nothing is not cheap. Its token is
    // compared with Modal's by the deploy check (deploy_env.py) instead.
    key: (env) => (env.OPENCMO_MOTION === "local" ? "local" : env.MOTION_PREVIEW_URL?.trim() && env.MOTION_PREVIEW_TOKEN?.trim() ? "modal" : ""),
    unset: "Set OPENCMO_MOTION=modal, MOTION_PREVIEW_URL and MOTION_PREVIEW_TOKEN (the same token as the Modal secret opencmo-motion).",
    testKey: (key, env) => (key === "local" && live(env) ? "OPENCMO_MOTION=local renders on this server: set it to modal in production." : null),
    okDetail: () => "Configured. The deploy check compares its token with Modal's.",
  },
  {
    id: "creem",
    label: "Creem (payments, prompt screening)",
    key: (env) => value(env, "CREEM_API_KEY"),
    unset: "Set CREEM_API_KEY. Without it no one can pay, and production blocks every AI image and video.",
    probe: (key) => ({
      url: `${key.startsWith("creem_test_") ? "https://test-api.creem.io" : "https://api.creem.io"}/v1/moderation/prompt`,
      init: {
        method: "POST",
        headers: { "x-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ prompt: CREEM_SAFE_PROMPT, external_id: "opencmo-costs-check" }),
      },
    }),
    judge: authFailed,
    testKey: (key, env) => (key.startsWith("creem_test_") && live(env) ? "A test key in production: checkouts go to the sandbox and prompt screening refuses every request." : null),
  },
  {
    id: "scrapecreators",
    label: "ScrapeCreators (research, Sales)",
    key: (env) => value(env, "SCRAPECREATORS_API_KEY", "SCRAPE_CREATORS_API_KEY"),
    unset: "Set SCRAPECREATORS_API_KEY. Without it research and Sales scans cannot read anything.",
    probe: (key) => ({ url: "https://api.scrapecreators.com/v1/credit/balance", init: { headers: { "x-api-key": key } } }),
    judge: authFailed,
  },
];

const INVALID = "The provider refused the key. Replace it, then reload this page in a few minutes.";

let cache: { at: number; fingerprint: string; rows: ProviderRow[] } | null = null;

/** Which keys are set, so a changed key is checked again at once. Not the keys: only their lengths and ends. */
const fingerprint = (env: Env) => SPECS.map((spec) => { const key = spec.key(env); return `${spec.id}:${key.length}:${key.slice(-4)}`; }).join("|");

export async function providerRows({ env = process.env, fetcher = fetch, now = Date.now() }: { env?: Env; fetcher?: Fetcher; now?: number } = {}): Promise<ProviderRow[]> {
  const print = fingerprint(env);
  const fresh = cache && cache.fingerprint === print && now - cache.at < CACHE_MS ? cache.rows : null;
  const rows =
    fresh ??
    (await Promise.all(
      SPECS.map(async (spec): Promise<ProviderRow> => {
        const base = { id: spec.id, label: spec.label };
        const key = spec.key(env);
        if (!key) return { ...base, state: "unset", detail: spec.unset };
        const test = spec.testKey?.(key, env);
        if (test) return { ...base, state: "test_key", detail: test };
        if (!spec.probe) return { ...base, state: "ok", detail: spec.okDetail?.(undefined) ?? "On." };
        const { state, status } = await probe(fetcher, spec.probe(key, env), spec.judge ?? authFailed);
        if (state === "invalid") return { ...base, state, detail: INVALID };
        if (state === "unreachable") return { ...base, state, detail: `The provider did not answer${status ? ` (status ${status})` : ""}. It may be down; check again later.` };
        return { ...base, state, detail: spec.okDetail?.(status) ?? "The key is accepted." };
      }),
    ));
  if (!fresh) cache = { at: now, fingerprint: print, rows };
  // A real call that failed on the key since the check: say so instead of an old "ok".
  return rows.map((row) => (row.id === "anthropic" && row.state === "ok" && accountDown("anthropic", now) ? { ...row, state: "invalid", detail: "A real call failed on the key or its credit in the last minutes." } : row));
}

export const clearProviderCache = (): void => {
  cache = null;
};

export const STATE_LABEL: Record<ProviderState, string> = {
  unset: "Not set",
  invalid: "Invalid key",
  test_key: "Test key in production",
  unreachable: "No answer",
  ok: "OK",
};
