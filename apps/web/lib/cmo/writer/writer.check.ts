/**
 * Writer's pure parts: the contract (kinds, the video brief shared with Studio).
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/writer/writer.check.ts
 */
import assert from "node:assert/strict";

import { VideoBriefSchema as StudioBriefSchema } from "@/lib/departments/studio/types";
import { briefRequest } from "@/lib/departments/studio/video";

import { PROFILE_KIND, VideoBriefSchema, WRITER_KINDS } from "./types";

assert.equal(StudioBriefSchema, VideoBriefSchema, "Studio takes Writer's video brief, not a copy");
assert.deepEqual(Object.keys(PROFILE_KIND).sort(), [...WRITER_KINDS].sort(), "every kind says which profile it drafts for");

const brief = VideoBriefSchema.parse({ objective: "Show founders a demo video made from one slash command", hooks: ["What if your demo made itself?"] });
assert.deepEqual([brief.cta, brief.angle, brief.seconds, brief.aspect], ["", "", 30, "9:16"], "an older brief without a call to action still parses");
assert.doesNotMatch(briefRequest(brief).prompt, /call to action/, "no call to action line when the brief has none");
const withCta = VideoBriefSchema.parse({ ...brief, cta: "Try /video on your own demo" });
assert.match(briefRequest(withCta).prompt, /End with this call to action: Try \/video on your own demo/, "the Director reads the brief's call to action");

console.log("writer.check: ok");
