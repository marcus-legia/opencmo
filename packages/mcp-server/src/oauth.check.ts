/**
 * The OAuth grant check of the MCP server (security fixes plan, fix 6), with no database: a stub
 * client plays Supabase Auth and the `mcp_grants` read.
 *
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server src/oauth.check.ts
 */

import assert from "node:assert/strict";

import { userForAccessToken } from "./oauth";
import type { SupabaseClient } from "./registry";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

/** `user`: what getUser returns; `grants`: the client ids with an active row for this user. */
function stub(user: { id: string } | null, grants: string[]) {
  const reads: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: "invalid" } }) },
    from(table: string) {
      reads.push(table);
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => ((filters[column] = value), query),
        is: (column: string, value: unknown) => ((filters[column] = value), query),
        maybeSingle: async () => {
          assert.equal(table, "mcp_grants");
          assert.equal(filters.revoked_at, null, "only active grants count");
          const hit = grants.includes(filters.client_id as string);
          return { data: hit ? { client_id: filters.client_id } : null, error: null };
        },
      };
      return query;
    },
  };
  return { make: () => client as unknown as SupabaseClient, reads };
}

const user = { id: "11111111-1111-4111-8111-111111111111" };
const token = jwt({ sub: user.id, client_id: "client-1" });

async function main(): Promise<void> {
  const granted = stub(user, ["client-1"]);
  assert.equal((await userForAccessToken(token, granted.make))?.userId, user.id, "a valid token with an active grant passes");

  const none = stub(user, []);
  assert.equal(await userForAccessToken(token, none.make), null, "valid getUser, no grant → 401");
  assert.deepEqual(none.reads, ["mcp_grants"], "the grant is read under the user's own client");

  assert.equal(await userForAccessToken(token, stub(user, ["client-2"]).make), null, "a grant for another client does not count");
  assert.equal(await userForAccessToken(token, stub(null, ["client-1"]).make), null, "an invalid token fails before the grant");
  assert.equal(await userForAccessToken(jwt({ sub: user.id }), stub(user, ["client-1"]).make), null, "a web session token (no client_id) is refused");
  assert.equal(await userForAccessToken("not-a-jwt", stub(user, ["client-1"]).make), null);

  console.log("oauth: tokens need an active grant.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
