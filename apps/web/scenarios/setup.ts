/**
 * Prepares the scenario user on the LOCAL Supabase stack: a password account (local auth only),
 * a credit top-up, and the source video. Refuses anything but a loopback Supabase, because
 * apps/web/.env.local points at production.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { isLoopbackUrl } from "../lib/local-supabase";

// Outside apps/web: `next dev` watches that tree, and traces written there make it recompile and
// reload the editor in a loop.
export const OUT = join(__dirname, "..", "..", "..", ".scenarios-out");
const STATE = join(OUT, "state.json");

export const EMAIL = "scenarios@opencmo.test";
const CREDITS = 3000;

export type ScenarioState = { url: string; anon: string; service: string; userId: string; email: string; password: string; video: string };

export default async function setup(): Promise<void> {
  const video = process.env.SCENARIO_VIDEO ?? "/home/marcus/Videos/record/day56.mp4";
  if (!existsSync(video)) throw new Error(`Source video not found: ${video}. Set SCENARIO_VIDEO.`);

  const local = localStack();
  if (!isLoopbackUrl(local.url)) throw new Error(`Refusing: ${local.url} is not a local Supabase.`);
  const health = await fetch("http://127.0.0.1:3000/").catch(() => null);
  if (!health) throw new Error("The dev stack is not running. Start it with `npm run dev` at the repo root.");

  const admin = createClient(local.url, local.serviceRoleKey, { auth: { persistSession: false } });
  const password = `scenario-${Math.random().toString(36).slice(2)}A1!`;
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((item) => item.email === EMAIL);
  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }

  const { data: balance } = await admin.rpc("credit_balance", { p_user_id: user.id });
  if (Number(balance ?? 0) < CREDITS) {
    const { error } = await admin.from("credit_ledger").insert({ user_id: user.id, delta: CREDITS - Number(balance ?? 0), reason: "Scenario top-up" });
    if (error) throw error;
  }

  mkdirSync(OUT, { recursive: true });
  const state: ScenarioState = { url: local.url, anon: local.anonKey, service: local.serviceRoleKey, userId: user.id, email: EMAIL, password, video };
  writeFileSync(STATE, JSON.stringify(state, null, 2));
}

export function readState(): ScenarioState {
  return JSON.parse(readFileSync(STATE, "utf8")) as ScenarioState;
}

/** Keys of the running local stack, from the CLI, never from an env file. */
function localStack(): { url: string; anonKey: string; serviceRoleKey: string } {
  const status = spawnSync("supabase", ["status", "-o", "env"], { cwd: join(__dirname, "..", "..", ".."), encoding: "utf8" });
  if (status.status !== 0) throw new Error("Local Supabase is not running (`supabase status` failed).");
  const values: Record<string, string> = {};
  for (const line of status.stdout.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) values[match[1]!] = match[2]!;
  }
  if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY) throw new Error("`supabase status` is missing keys.");
  return { url: values.API_URL, anonKey: values.ANON_KEY, serviceRoleKey: values.SERVICE_ROLE_KEY };
}
