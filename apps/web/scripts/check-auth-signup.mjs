/**
 * Email/password signup must be refused (security fixes plan, fix 4): the product signs in with
 * Google only, and an open signup endpoint is a free path to mass accounts.
 *
 *     npm run check:auth-signup --workspace @opencmo/web
 *
 * Talks only to the local stack (`supabase status`), never to a remote project. Production is the
 * owner's dashboard setting (O1); this check guards `supabase/config.toml`.
 */
import { execFileSync } from "node:child_process";

const status = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const env = Object.fromEntries(
  status.split("\n").flatMap((line) => {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    return match ? [[match[1], match[2]]] : [];
  }),
);
const url = new URL(env.API_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error(`Refusing a non-local Supabase: ${url.host}`);

const response = await fetch(new URL("/auth/v1/signup", url), {
  method: "POST",
  headers: { apikey: env.ANON_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: `signup-check-${Date.now()}@test.local`, password: "a-long-enough-password-1" }),
});
const body = await response.text();
if (response.status < 400 || response.status >= 500) {
  console.error(`Email signup should be refused with a 4xx; got ${response.status}: ${body.slice(0, 200)}`);
  process.exit(1);
}
console.log(`Email signup refused (${response.status}).`);
