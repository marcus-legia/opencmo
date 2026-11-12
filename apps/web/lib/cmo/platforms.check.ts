/**
 * The platform profiles hold (`packages/contracts/platforms.json`, writer.md §7, P3 A0):
 *
 *     cd apps/web && npx tsx lib/cmo/platforms.check.ts
 *
 * The file follows `platforms.schema.json` (compared field by field with the zod schema so the two cannot drift),
 * the product rules hold (no hashtags in posts, a title only for YouTube), and SQL's `platform_profile()` in the
 * latest migration that defines it has the same numbers.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLATFORMS } from "../screens/common";

import { PLATFORM_LABELS, PROFILES, PROFILE_KINDS, PlatformProfileSchema, countHashtags, postProfile, profileIdOf, profileOf } from "./platforms";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const failures: string[] = [];
function check(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

check("the JSON schema has the zod schema's enums and fields", () => {
  type Def = { required: string[]; properties: Record<string, { enum?: string[] }> };
  const schema = JSON.parse(readFileSync(join(ROOT, "packages", "contracts", "platforms.schema.json"), "utf8")) as { $defs: { profile: Def } };
  const def = schema.$defs.profile;
  // null is the core post's: it goes to every platform the planner picked, so it names none.
  assert.deepEqual(def.properties.platform!.enum, [...PLATFORMS, null]);
  assert.deepEqual(def.properties.kind!.enum, [...PROFILE_KINDS]);
  const fields = Object.keys(PlatformProfileSchema.shape);
  assert.deepEqual([...def.required].sort(), [...fields].sort());
  assert.deepEqual(Object.keys(def.properties).sort(), [...fields].sort());
});

check("ids are unique and the seven profiles are there", () => {
  const ids = PROFILES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ["core", "instagram_caption", "linkedin", "threads", "tiktok_caption", "x", "youtube"]);
});

check("the core post names no platform, and only it", () => {
  for (const p of PROFILES) assert.equal(p.platform === null, p.kind === "core", `${p.id}: platform`);
  const core = profileOf("core")!;
  assert.deepEqual([core.label, core.limit, core.visibleBeforeMore, core.hashtags], ["Post", 3000, 140, 0]);
  assert.equal(PlatformProfileSchema.safeParse({ ...profileOf("x")!, platform: null }).success, false, "a platform post names its platform");
});

check("one post for 2+ targets is the core post; one target is written for its platform", () => {
  assert.equal(postProfile("X", ["x", "linkedin"]).id, "core");
  assert.equal(postProfile("Threads", ["threads", "linkedin", "x"]).id, "core");
  assert.equal(postProfile("LinkedIn", ["linkedin"]).id, "linkedin");
  assert.equal(postProfile("Threads").id, "threads", "an old item without targets keeps its platform");
  assert.equal(postProfile("X", []).id, "x");
  assert.equal(postProfile("core").id, "core", "the MCP inbox reads the core profile back from its <platform> block");
});

check("product rules: no hashtags in posts, a title only for YouTube, the marker inside the limit", () => {
  for (const p of PROFILES) {
    if (p.kind === "post" || p.kind === "core") assert.equal(p.hashtags, 0, `${p.id}: hashtags only on videos`);
    assert.equal(p.title !== null, p.kind === "youtube", `${p.id}: title`);
    if (p.visibleBeforeMore !== null) assert.ok(p.visibleBeforeMore < p.limit, `${p.id}: visibleBeforeMore`);
  }
  const x = PROFILES.find((p) => p.id === "x")!;
  // D6 (owner, 2026-11-12): most founders have X Premium; a free account's refusal is handled at publish time.
  assert.equal(x.limit, 25000, "X takes a long post");
});

check("hashtags are counted the way platforms count them", () => {
  assert.equal(countHashtags("Cut by words #editing #SaaS"), 2);
  assert.equal(countHashtags("#buildinpublic at the start"), 1);
  assert.equal(countHashtags("Issue #12, C# and a#b are not hashtags"), 0);
  assert.equal(countHashtags("Tôi #dựng_video"), 1);
});

/** `platform_profile` as the latest migration defining it writes it: `when '<id>' then '<json>'::jsonb`. */
export function sqlProfiles(sql: string): Map<string, unknown> | null {
  const matches = [...sql.matchAll(/function public\.platform_profile\(p_id text\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)];
  const last = matches.at(-1);
  if (!last) return null;
  return new Map([...last[1]!.matchAll(/when '([a-z_]+)' then '(\{[^']*\})'::jsonb/g)].map((m) => [m[1]!, JSON.parse(m[2]!) as unknown]));
}

check("SQL's platform_profile() has the file's numbers", () => {
  const dir = join(ROOT, "supabase", "migrations");
  let found: Map<string, unknown> | null = null;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    found = sqlProfiles(readFileSync(join(dir, file), "utf8")) ?? found;
  }
  assert.ok(found, "platform_profile not found in any migration");
  assert.deepEqual([...found.keys()].sort(), PROFILES.map((p) => p.id).sort());
  for (const p of PROFILES) {
    assert.deepEqual(found.get(p.id), { kind: p.kind, limit: p.limit, title: p.title, hashtags: p.hashtags, label: p.label }, p.id);
  }
});

/** `platform_profile_id` as the latest migration defining it writes it: `when '<label>' then '<id>'`. */
export function sqlLabels(sql: string): Map<string, string> | null {
  const last = [...sql.matchAll(/create (?:or replace )?function public\.platform_profile_id\(p_label text\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)].at(-1);
  if (!last) return null;
  return new Map([...last[1]!.matchAll(/when '([a-z_ ]+)' then '([a-z_]+)'/g)].map((m) => [m[1]!, m[2]!]));
}

check("SQL's platform_profile_id() maps the same labels to the same profiles", () => {
  const dir = join(ROOT, "supabase", "migrations");
  let found: Map<string, string> | null = null;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    found = sqlLabels(readFileSync(join(dir, file), "utf8")) ?? found;
  }
  assert.ok(found, "platform_profile_id not found in any migration");
  assert.deepEqual(Object.fromEntries([...found].sort()), Object.fromEntries(Object.entries(PLATFORM_LABELS).sort()));
  for (const id of new Set(Object.values(PLATFORM_LABELS))) assert.ok(profileOf(id), `${id} is a profile`);
  // `core` is never a calendar label: an item's platform stays its first target's.
  for (const p of PROFILES) assert.equal(profileIdOf(p.id), p.kind === "core" ? null : p.id, `${p.id} maps to itself`);
  assert.equal(profileIdOf(" X "), "x");
  assert.equal(profileIdOf("LinkedIn"), "linkedin");
  assert.equal(profileIdOf("Reddit"), null);
});

if (failures.length) {
  console.error(`platforms.check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`platforms.check: ${PROFILES.length} profiles ok`);
