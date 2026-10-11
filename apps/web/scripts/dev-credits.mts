/**
 * Adds credits to a user on the LOCAL Supabase stack, so AI media can be tried in dev (new
 * accounts start at 0 and the only real top-up is the Polar webhook).
 *
 *   npm run dev:credits -- you@example.com          # +1000
 *   npm run dev:credits -- you@example.com 250
 *
 * Refuses anything but a loopback Supabase: apps/web/.env.local points at production, so the
 * credentials come from `supabase status`, never from the environment.
 */

import { createClient } from '@supabase/supabase-js';

import { isLoopbackUrl, localSupabaseCredentials } from '../lib/local-supabase';

const [email, amount = '1000'] = process.argv.slice(2);
const credits = Number(amount);
if (!email || !Number.isInteger(credits) || credits <= 0 || credits > 1_000_000) {
  console.error('Usage: npm run dev:credits -- <email> [credits, default 1000]');
  process.exit(1);
}
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
  const value = process.env[name];
  if (value && !isLoopbackUrl(value)) {
    console.error(`Refusing: ${name} is not a local Supabase (${new URL(value).host}).`);
    process.exit(1);
  }
}

const local = localSupabaseCredentials({ cwd: process.cwd() });
const db = createClient(local.url, local.serviceRoleKey, { auth: { persistSession: false } });

let user: { id: string; email?: string } | undefined;
for (let page = 1; !user; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
  if (data.users.length < 1000) break;
}
if (!user) {
  console.error(`No local user with the email ${email}. Sign up at http://127.0.0.1:3000 first.`);
  process.exit(1);
}

const { error } = await db.from('credit_ledger').insert({ user_id: user.id, delta: credits, reason: 'Dev top-up' });
if (error) throw error;
const { data: balance, error: balanceError } = await db.rpc('credit_balance', { p_user_id: user.id });
if (balanceError) throw balanceError;
console.log(`${email}: +${credits} credits, balance ${balance}.`);
