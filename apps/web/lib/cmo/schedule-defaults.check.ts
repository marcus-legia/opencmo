/**
 * The default posting slots hold (`packages/contracts/schedule-defaults.json`, P4 A1):
 *
 *     cd apps/web && npx tsx lib/cmo/schedule-defaults.check.ts
 *
 * The file follows its schema, every publish platform has slots, two default slots of one platform keep the minimum
 * gap, and SQL's `schedule_rules()` in the latest migration that defines it returns the same object.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLISH_PLATFORMS } from "../departments/publish/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const read = (file: string) => JSON.parse(readFileSync(join(ROOT, "packages", "contracts", file), "utf8")) as Record<string, unknown>;

type Rules = {
  minGapHours: number;
  windowMinutes: number;
  leadMinutes: number;
  horizonDays: number;
  maxProposals: number;
  jitterSeconds: number;
  platforms: Record<string, { times: string[]; dailyCap: number }>;
};

const failures: string[] = [];
function check(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const file = read("schedule-defaults.json");
const schema = read("schedule-defaults.schema.json") as {
  required: string[];
  properties: Record<string, { minimum?: number; maximum?: number; required?: string[] }>;
};
const rules = Object.fromEntries(Object.entries(file).filter(([k]) => !k.startsWith("$"))) as Rules;

check("the file has exactly the schema's fields, within bounds", () => {
  assert.deepEqual(Object.keys(rules).sort(), [...schema.required].sort());
  for (const key of schema.required.filter((k) => k !== "platforms")) {
    const value = rules[key as keyof Rules] as number;
    const def = schema.properties[key]!;
    assert.ok(Number.isInteger(value) && value >= def.minimum! && value <= def.maximum!, `${key} = ${value}`);
  }
});

check("every publish platform has default slots, and nothing else does", () => {
  assert.deepEqual(Object.keys(rules.platforms).sort(), [...PUBLISH_PLATFORMS].sort());
  assert.deepEqual([...schema.properties.platforms!.required!].sort(), [...PUBLISH_PLATFORMS].sort());
});

check("slots are HH:MM, in order, and keep the minimum gap", () => {
  for (const [platform, { times, dailyCap }] of Object.entries(rules.platforms)) {
    const minutes = times.map((t) => {
      assert.match(t, /^([01][0-9]|2[0-3]):[0-5][0-9]$/, `${platform} ${t}`);
      return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    });
    for (let i = 1; i < minutes.length; i++) {
      assert.ok(minutes[i]! - minutes[i - 1]! >= rules.minGapHours * 60, `${platform}: ${times[i - 1]} and ${times[i]} are closer than the gap`);
    }
    assert.ok(Number.isInteger(dailyCap) && dailyCap >= times.length, `${platform}: the cap allows every default slot`);
  }
  assert.equal(rules.platforms.x!.dailyCap, 5, "X keeps five a day (owner, 2026-10-26)");
});

check("the jitter stays inside the window", () => {
  assert.ok(rules.jitterSeconds < rules.windowMinutes * 60);
});

check("SQL's schedule_rules() returns the same object", () => {
  const dir = join(ROOT, "supabase", "migrations");
  let literal: string | null = null;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const m = /function public\.schedule_rules\(\)[\s\S]*?select '(\{[\s\S]*?\})'::jsonb/.exec(readFileSync(join(dir, name), "utf8"));
    if (m) literal = m[1]!;
  }
  assert.ok(literal, "no migration defines schedule_rules()");
  assert.deepEqual(JSON.parse(literal!.replaceAll("''", "'")), rules);
});

if (failures.length > 0) {
  console.error(`schedule-defaults.check: ${failures.length} failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`schedule-defaults.check: ${Object.keys(rules.platforms).length} platforms ok`);
