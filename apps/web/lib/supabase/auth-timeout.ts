/**
 * A time limit on a question to Supabase Auth.
 *
 * When an access token needs a refresh and Auth does not answer, supabase-js retries with a growing wait for up to
 * 30 seconds before `getClaims()` returns (measured: 25 s against a closed port), and `getUser()` waits on a hung
 * connection for as long as the function lives. The middleware asks on every request, so an Auth incident held every
 * page and every API call of a signed-in founder until the platform cut the request. A refresh that works takes well
 * under a second: past this limit the answer is "Auth is unavailable", in the shape supabase-js gives a network
 * failure, so callers treat a slow Auth and an unreachable one alike (`authUnavailable`, `lib/supabase/user.ts`).
 *
 * No imports: the middleware runs it on the edge runtime.
 */
export const AUTH_TIMEOUT_MS = 4000;

export const AUTH_TIMED_OUT = { name: "AuthRetryableFetchError", status: 0, message: "Supabase Auth did not answer in time." } as const;

/** `ask()`, or `{ data: null, error: AUTH_TIMED_OUT }` once `ms` have passed. The late answer, if any, is dropped. */
export async function authWithin<T extends { data: unknown; error: unknown }>(
  ask: () => PromiseLike<T>,
  ms: number = AUTH_TIMEOUT_MS,
): Promise<T | { data: null; error: typeof AUTH_TIMED_OUT }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ data: null; error: typeof AUTH_TIMED_OUT }>((resolve) => {
    timer = setTimeout(() => resolve({ data: null, error: AUTH_TIMED_OUT }), ms);
  });
  try {
    return await Promise.race([Promise.resolve(ask()), late]);
  } finally {
    clearTimeout(timer);
  }
}
