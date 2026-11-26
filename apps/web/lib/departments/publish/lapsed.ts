import "server-only";

import type { PublishAdapter } from "./types";

/** What the cleanup cron needs from the database (`lapsed_social_accounts`, `social_account_drop`). */
export type LapsedStore = {
  lapsed(limit: number): Promise<{ id: string; userId: string; zernioAccountId: string }[]>;
  drop(userId: string, id: string): Promise<void>;
};

/**
 * Disconnects the posting accounts of founders whose plan lapsed (20270206070000): Zernio bills each connected account
 * by the day, and a founder without a plan cannot send a post anyway. Zernio first, then here, as a founder's own
 * Disconnect does: an account dropped only here would stay billable there. One account failing at Zernio leaves it
 * for the next daily run and does not stop the others.
 */
export async function disconnectLapsed(adapter: Pick<PublishAdapter, "disconnect">, store: LapsedStore, limit = 100): Promise<{ dropped: number; failed: number }> {
  let dropped = 0;
  let failed = 0;
  for (const account of await store.lapsed(limit)) {
    try {
      await adapter.disconnect(account.zernioAccountId);
      await store.drop(account.userId, account.id);
      dropped++;
    } catch (error) {
      failed++;
      console.error("[cleanup] could not disconnect a lapsed account", error instanceof Error ? error.message : error);
    }
  }
  return { dropped, failed };
}
