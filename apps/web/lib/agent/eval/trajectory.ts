/**
 * Rules on HOW the Assistant got to the result, not only the final document (plan C4): a task can
 * end in the right edit after spending credits it did not need, looping on a tool, or editing
 * before the founder answered its question. Each rule returns the graders' `{ ok, note }` shape.
 */

import { isWriteTool } from "../tools";

export type Call = { name: string; input?: unknown };
export type Rule = { ok: boolean; note: string };

/** Tools that put a priced card in front of the founder. */
export const PAID_TOOLS = new Set(["create_video", "generate_media", "add_voiceover", "add_3d_scene", "add_explainer", "replace_background", "edit_video", "plan_video"]);

const list = (calls: Call[]) => calls.map((call) => call.name).join(", ") || "none";

export function toolUsed(calls: Call[], name: string, { min = 1, max = Number.POSITIVE_INFINITY }: { min?: number; max?: number } = {}): Rule {
  const count = calls.filter((call) => call.name === name).length;
  return { ok: count >= min && count <= max, note: `${name} called ${count} times (expected ${min}${max === Number.POSITIVE_INFINITY ? "+" : max === min ? "" : `–${max}`})` };
}

export function forbidden(calls: Call[], names: Iterable<string> | ((name: string) => boolean), label = "forbidden tools"): Rule {
  const banned = typeof names === "function" ? names : ((set: Set<string>) => (name: string) => set.has(name))(new Set(names));
  const hits = calls.filter((call) => banned(call.name));
  return { ok: !hits.length, note: `${label}: ${list(hits)}` };
}

/** Each name appears, and its first call comes after the first call of the one before it. */
export function inOrder(calls: Call[], names: string[]): Rule {
  let at = -1;
  for (const name of names) {
    const next = calls.findIndex((call, index) => index > at && call.name === name);
    if (next < 0) return { ok: false, note: `expected ${names.join(" → ")}, got ${list(calls)}` };
    at = next;
  }
  return { ok: true, note: "" };
}

/** At most `n` tool calls: simple edits should not wander. */
export function maxSteps(calls: Call[], n: number): Rule {
  return { ok: calls.length <= n, note: `${calls.length} tool calls (at most ${n}): ${list(calls)}` };
}

/** The calls before the first call of `name` (all of them when it never came). */
export function before(calls: Call[], name: string): Call[] {
  const index = calls.findIndex((call) => call.name === name);
  return index < 0 ? calls : calls.slice(0, index);
}

/** Records the note of every failing rule; true when all pass. */
export function trajectory(notes: string[], ...rules: Rule[]): boolean {
  for (const rule of rules) if (!rule.ok) notes.push(rule.note);
  return rules.every((rule) => rule.ok);
}

export const writes = (name: string) => isWriteTool(name) || PAID_TOOLS.has(name);
