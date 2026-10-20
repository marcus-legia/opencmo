/**
 * /video moderation names the blocked pieces. Offline: fake moderation blocks text with [[flag]].
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/screen-pieces.check.ts
 */
import assert from "node:assert/strict";

import { screenPieces } from "./screen-pieces";

async function main(): Promise<void> {
  process.env.OPENCMO_AI_FAKE = "1";
  // Any provider key turns real moderation on (lib/cmo/agents/registry.ts).
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "OPENAI_COMPAT_API_KEY", "FAL_KEY"]) delete process.env[key];
  const spec = (prompt: string) => ({ prompt, aspectRatio: "9:16", duration: 5, seed: 1 });
  const clean = [
    { label: "Shot 1 (a laptop)", spec: spec("a laptop on a desk") },
    { label: "The music", spec: spec("calm piano") },
  ];
  assert.equal(await screenPieces(clean), null);

  const result = await screenPieces([...clean, { label: "Shot 2 (a crowd)", spec: spec("a crowd [[flag]]") }]);
  assert.ok(result);
  const message = (JSON.parse(result.content) as { INVALID_INPUT: string }).INVALID_INPUT;
  assert.match(message, /Shot 2 \(a crowd\)/);
  assert.doesNotMatch(message, /Shot 1|music/, "only the blocked piece is named");
  assert.equal(result.summary, "1 piece blocked");
  console.log("screen-pieces: every check passed");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
