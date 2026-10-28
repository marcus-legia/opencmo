/**
 * The capability registry holds (`packages/contracts/capabilities.json`, brain.md §7, P2 F1):
 *
 *     cd apps/web && npx tsx lib/cmo/capabilities.check.ts
 *
 * Every entry follows `capabilities.schema.json` (the same rules as the zod schema below, compared field by field so
 * the two cannot drift), every CMO job is listed once, and a job's fixed price is the one SQL charges
 * (`cmo_job_price` in the latest migration that defines it). Studio entry points and the caller-path check: A4.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { CMO_JOB_KINDS } from "./jobs/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const read = (...path: string[]) => JSON.parse(readFileSync(join(ROOT, ...path), "utf8")) as unknown;

export const DEPARTMENTS = ["brain", "research", "writer", "studio", "sales", "schedule", "publish"] as const;
export const EFFECTS = ["read", "write", "spend", "outbound"] as const;
export const APPROVALS = ["none", "founder", "price"] as const;
export const CALLERS = ["brain", "assistant", "mcp", "ui"] as const;

const name = z.string().regex(/^[a-z_]{1,40}$/);
export const CapabilitySchema = z
  .object({
    name,
    department: z.enum(DEPARTMENTS),
    effect: z.enum(EFFECTS),
    approval: z.enum(APPROVALS),
    callers: z
      .array(z.enum(CALLERS))
      .min(1)
      .refine((list) => new Set(list).size === list.length, "callers repeat"),
    order_kind: name.nullable(),
    max_steps: z.number().int().min(1).max(200),
    credits: z.union([z.number().int().min(0), z.literal("quote")]),
    input: z.string().min(1).max(80),
    $comment: z.string().optional(),
  })
  .strict();
export type Capability = z.infer<typeof CapabilitySchema>;

export const RegistrySchema = z
  .object({ $schema: z.string().optional(), $comment: z.string().optional(), capabilities: z.array(CapabilitySchema).min(1) })
  .strict();

const failures: string[] = [];
function check(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const registry = RegistrySchema.parse(read("packages", "contracts", "capabilities.json"));
const byName = new Map(registry.capabilities.map((c) => [c.name, c]));

check("names are unique", () => assert.equal(byName.size, registry.capabilities.length));

check("the JSON schema has the zod schema's enums and fields", () => {
  type Def = { required: string[]; properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> };
  const schema = read("packages", "contracts", "capabilities.schema.json") as { $defs: { capability: Def } };
  const def = schema.$defs.capability;
  assert.deepEqual(def.properties.department!.enum, [...DEPARTMENTS]);
  assert.deepEqual(def.properties.effect!.enum, [...EFFECTS]);
  assert.deepEqual(def.properties.approval!.enum, [...APPROVALS]);
  assert.deepEqual(def.properties.callers!.items!.enum, [...CALLERS]);
  const fields = Object.keys(CapabilitySchema.shape).filter((key) => key !== "$comment");
  assert.deepEqual([...def.required].sort(), [...fields].sort());
  assert.deepEqual(Object.keys(def.properties).sort(), Object.keys(CapabilitySchema.shape).sort());
});

check("every CMO job is listed, with its order kind", () => {
  for (const kind of [...CMO_JOB_KINDS, "onboard"]) {
    const entry = byName.get(kind);
    assert.ok(entry, `${kind} missing`);
    if (kind !== "onboard") assert.equal(entry.order_kind, kind, kind);
  }
});

/** `cmo_job_price` as the latest migration defining it writes it: `when '<kind>' then <n>`. */
export function sqlPrices(sql: string): Map<string, number> | null {
  const matches = [...sql.matchAll(/function public\.cmo_job_price\(p_kind text\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)];
  const last = matches.at(-1);
  if (!last) return null;
  return new Map([...last[1]!.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1]!, Number(m[2])]));
}

check("a job's price is the one SQL charges", () => {
  const dir = join(ROOT, "supabase", "migrations");
  let prices: Map<string, number> | null = null;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    prices = sqlPrices(readFileSync(join(dir, file), "utf8")) ?? prices;
  }
  assert.ok(prices, "cmo_job_price not found in any migration");
  for (const kind of CMO_JOB_KINDS) assert.equal(byName.get(kind)!.credits, prices.get(kind) ?? 0, kind);
});

check("spending needs a card or a fixed price", () => {
  for (const c of registry.capabilities) {
    if (c.credits === "quote") assert.equal(c.approval, "price", `${c.name}: a quoted price is shown on a card`);
    if (c.effect === "outbound") assert.notEqual(c.approval, "none", `${c.name}: outbound always waits on the founder`);
  }
});

if (failures.length) {
  console.error(`capabilities.check: ${failures.length} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`capabilities.check: ${registry.capabilities.length} capabilities ok`);
