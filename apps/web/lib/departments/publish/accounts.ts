/**
 * Connecting and disconnecting the founder's accounts through Zernio (P4 B2, F1). The routes under
 * `app/api/v1/accounts/` are thin: this module holds the rules so a check can run them with a fake store.
 *
 * Trust: the callback's query string comes from the browser, so an account id in it is never stored as
 * is. It is stored only when Zernio lists that account, on that platform, under this founder's own
 * profile. That is why `social_account_save` is service-role only (A0) and runs after this check.
 */

import { PLATFORM_LABEL } from "@/lib/screens/common";

import { PublishError, type ConnectedAccount, type PublishAdapter, type PublishPlatform } from "./types";

export type AccountRow = { id: string; platform: PublishPlatform; zernioAccountId: string };

/** The reads run under the founder's RLS session; the two saves through the service role (A0's RPCs). */
export type AccountsStore = {
  profileId(userId: string): Promise<string | null>;
  saveProfile(userId: string, zernioProfileId: string): Promise<void>;
  saveAccount(userId: string, account: ConnectedAccount): Promise<{ id: string }>;
  account(id: string): Promise<AccountRow | null>;
  removeAccount(id: string): Promise<void>;
};

export type AccountsDeps = { adapter: PublishAdapter; store: AccountsStore; userId: string };

/** The founder's Zernio profile, made the first time they connect anything. */
export async function ensureProfile({ adapter, store, userId }: AccountsDeps): Promise<string> {
  const known = await store.profileId(userId);
  if (known) return known;
  const { zernioProfileId } = await adapter.createProfile(userId);
  await store.saveProfile(userId, zernioProfileId);
  return zernioProfileId;
}

/** Where the founder goes to agree: Zernio's OAuth page for one platform. */
export async function connectUrl(deps: AccountsDeps, platform: PublishPlatform, callbackBase: string): Promise<string> {
  const profile = await ensureProfile(deps);
  const back = new URL(callbackBase);
  back.searchParams.set("platform", platform);
  return (await deps.adapter.connectLink(profile, platform, back.toString())).url;
}

export type Finished = { kind: "connected"; platform: PublishPlatform; handle: string } | { kind: "refused"; message: string };

/**
 * Back from Zernio. Zernio adds `connected`, `accountId` on success and `error` on failure; its error text
 * is not shown (it is the browser's query string), only our own sentence.
 */
export async function finishConnect(deps: AccountsDeps, query: URLSearchParams): Promise<Finished> {
  const platform = query.get("platform") as PublishPlatform | null;
  const label = platform && platform in PLATFORM_LABEL ? PLATFORM_LABEL[platform] : "The account";
  if (!platform || !(platform in PLATFORM_LABEL) || platform === ("reddit" as string)) {
    return { kind: "refused", message: "That connect link is not valid. Start again from Settings." };
  }
  if (query.get("error")) return { kind: "refused", message: `${label} was not connected. Try again, and allow access when asked.` };
  const accountId = query.get("accountId");
  const profile = await deps.store.profileId(deps.userId);
  if (!accountId || !profile) return { kind: "refused", message: `${label} was not connected. Start again from Settings.` };
  const account = (await deps.adapter.accounts(profile)).find((a) => a.zernioAccountId === accountId && a.platform === platform);
  if (!account) return { kind: "refused", message: `${label} was not connected. Start again from Settings.` };
  await deps.store.saveAccount(deps.userId, account);
  return { kind: "connected", platform, handle: account.handle };
}

/**
 * Disconnects at Zernio first, then here: an account removed only here would stay able to post at Zernio.
 * An account Zernio no longer knows counts as disconnected there.
 */
export async function disconnectAccount(deps: AccountsDeps, id: string): Promise<boolean> {
  const row = await deps.store.account(id);
  if (!row) return false;
  await deps.adapter.disconnect(row.zernioAccountId);
  await deps.store.removeAccount(id);
  return true;
}

/** An adapter error as the route's status: the founder's words stay, the cause decides the code. */
export function publishErrorStatus(error: PublishError): number {
  switch (error.code) {
    case "invalid":
      return 422;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "not_configured":
    case "unavailable":
      return 503;
    case "auth":
      return 502;
  }
}
