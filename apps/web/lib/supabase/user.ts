import { cache } from "react";

import { authWithin } from "./auth-timeout";
import { createServerClient } from "./server";

export type SignedInUser = { id: string; email: string | null };

type Client = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Who is signed in, from the session cookie's JWT.
 *
 * `getClaims()` checks the token's signature against the project's ES256 public key (fetched once per instance from
 * the JWKS endpoint and cached), so a request costs no round trip to Supabase Auth. `getUser()` costs one every time,
 * and the layout, the page and the middleware each called it: three trips across the country before the first byte.
 * A forged or edited cookie still fails, which is what `getSession()` could not promise. What it gives up is noticing a
 * revoked session before the access token expires (an hour at most); PostgREST trusts the same JWT under RLS, so no
 * read or write gets more than the token already allows.
 */
export async function claimsUser(supabase: Client): Promise<SignedInUser | null> {
  return (await checkedUser(supabase)).user;
}

/**
 * True when Supabase Auth could not answer (a network failure, a timeout, a 5xx), as opposed to answering "this is
 * not a session". supabase-js marks the first kind `AuthRetryableFetchError`; an API error carries its HTTP status.
 */
export function authUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  return name === "AuthRetryableFetchError" || (typeof status === "number" && status >= 500);
}

/**
 * `claimsUser`, and whether "nobody" only means Auth could not be asked: the token needed a refresh, or the public
 * key was not cached yet, while Auth was down. A page treats both as signed out; the API tells the caller to try
 * again instead of to sign in again (`lib/api/handler.ts`).
 */
export async function checkedUser(supabase: Client): Promise<{ user: SignedInUser | null; unavailable: boolean }> {
  const { data, error } = await authWithin(() => supabase.auth.getClaims());
  const claims = data?.claims;
  if (error || !claims?.sub) return { user: null, unavailable: authUnavailable(error) };
  return { user: { id: claims.sub, email: typeof claims.email === "string" && claims.email ? claims.email : null }, unavailable: false };
}

/** `claimsUser` once per request: the layout and the page ask the same question. */
export const currentUser = cache(async (): Promise<SignedInUser | null> => claimsUser(await createServerClient()));
