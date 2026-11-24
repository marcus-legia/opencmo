/**
 * Whether a post's platform has a connected account (owner, 2026-11-24): an approved post for an account that is not
 * connected never goes out on its own, so its row says "Post it yourself", never "Scheduled". Pure.
 */

/** The platforms with a connected account, from `social_accounts` rows. */
export function connectedPlatforms(rows: readonly { platform: string; status: string }[]): Set<string> {
  return new Set(rows.filter((r) => r.status === "connected").map((r) => r.platform));
}

/**
 * Each row with `connected` set: false only when none of the platforms it goes to has a connected account (a core post
 * goes to all of `targets`, else to `platform`), since a connected one still posts on its own. `postYourself` names the
 * ones the founder posts by hand when some are connected and some are not (review 2026-11-24: "Post it yourself" on a
 * core post whose X was connected made a founder post to X by hand, and X got it twice). Null (a read that failed)
 * leaves rows as they were.
 */
export function withConnected<T extends { platform: string; targets?: readonly string[] }>(
  rows: T[],
  connected: ReadonlySet<string> | null,
): (T & { connected?: boolean; postYourself?: string[] })[] {
  if (!connected) return rows;
  return rows.map((r) => {
    const goes = r.targets?.length ? r.targets : [r.platform];
    const missing = goes.filter((p) => !connected.has(p));
    return { ...r, connected: missing.length < goes.length, ...(missing.length && missing.length < goes.length ? { postYourself: missing } : {}) };
  });
}
