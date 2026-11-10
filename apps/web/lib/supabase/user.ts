import { cache } from "react";

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
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" && claims.email ? claims.email : null };
}

/** `claimsUser` once per request: the layout and the page ask the same question. */
export const currentUser = cache(async (): Promise<SignedInUser | null> => claimsUser(await createServerClient()));
