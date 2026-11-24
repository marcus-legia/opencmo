/**
 * Whether a post's platform has a connected account (owner, 2026-11-24): an approved post for an account that is not
 * connected never goes out on its own, so its row says "Post it yourself", never "Scheduled". Pure.
 */

/** The platforms with a connected account, from `social_accounts` rows. */
export function connectedPlatforms(rows: readonly { platform: string; status: string }[]): Set<string> {
  return new Set(rows.filter((r) => r.status === "connected").map((r) => r.platform));
}

/**
 * Each row with `connected` set: true only when every platform it goes to has a connected account (a core post goes
 * to all of `targets`, else to `platform`). Null (a read that failed) leaves rows as they were.
 */
export function withConnected<T extends { platform: string; targets?: readonly string[] }>(rows: T[], connected: ReadonlySet<string> | null): (T & { connected?: boolean })[] {
  if (!connected) return rows;
  return rows.map((r) => ({ ...r, connected: (r.targets?.length ? r.targets : [r.platform]).every((p) => connected.has(p)) }));
}
