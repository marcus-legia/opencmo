/**
 * A fake Zernio with the adapter's interface (P4 B0): tests, e2e and the acceptance run post through it,
 * selected by `OPENCMO_PUBLISH_FAKE=1` (`adapter.ts`). Nothing leaves the machine.
 *
 * It keeps Zernio's promises that the rest of P4 relies on: one post per idempotency key (a retried
 * order gets the first answer back), accounts per profile, disconnect that really forgets the account.
 * A post's text picks a failure on purpose so e2e can reach the failed and fallback cards:
 * `[fake:invalid]` → refused by the platform, `[fake:down]` → Zernio unavailable (retryable).
 */

import { createHash } from "node:crypto";

import { PLATFORM_LABEL } from "@/lib/screens/common";

import {
  PublishDeliverableSchema,
  PublishError,
  PublishSlotSchema,
  type ConnectedAccount,
  type CreatorInfo,
  type PublishAdapter,
  type PublishDeliverable,
  type PublishPlatform,
  type PublishResult,
  type PublishSlot,
} from "./types";

export type FakeOptions = {
  /** Where the fake's presigned uploads go: a local sink the acceptance run starts (`publish_media` PUTs there). */
  uploadBase?: string;
  /**
   * `now`: the post comes back `published` (e2e on live rows). `webhook`: it comes back `accepted` and
   * the signed webhook confirms it (the acceptance run, F11).
   */
  confirm?: "now" | "webhook";
};

/** The fake's state, shared by every adapter made in one process so a route and the runner see the same accounts. */
type FakeState = {
  profiles: Set<string>;
  accounts: Map<string, ConnectedAccount & { zernioProfileId: string }>;
  posts: Map<string, PublishResult>;
  calls: { publish: number };
};

const STATE_KEY = Symbol.for("opencmo.publish.fake");
function state(): FakeState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: FakeState };
  g[STATE_KEY] ??= { profiles: new Set(), accounts: new Map(), posts: new Map(), calls: { publish: 0 } };
  return g[STATE_KEY];
}

/** Clears the fake between tests. */
export function resetFakePublish(): void {
  const s = state();
  s.profiles.clear();
  s.accounts.clear();
  s.posts.clear();
  s.calls.publish = 0;
}

/** How many posts reached the fake (a retried key is not counted twice): "never twice" in tests. */
export const fakePublishCount = (): number => state().calls.publish;

const id = (prefix: string, ...parts: string[]) => `${prefix}_${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16)}`;

/** The account the fake's connect "OAuth" makes: the callback reads it back through `accounts`. */
export const fakeAccountId = (zernioProfileId: string, platform: PublishPlatform) => id("fake_acc", zernioProfileId, platform);

/**
 * The fake's connect link points back at the return URL with the account already connected, as Zernio's
 * OAuth would after the founder agrees. The account is made here so the callback finds it.
 */
function connect(zernioProfileId: string, platform: PublishPlatform, returnUrl: string): { url: string } {
  const s = state();
  if (!s.profiles.has(zernioProfileId)) throw new PublishError("not_found", "Your posting profile was not found. Try connecting again.", false);
  const zernioAccountId = fakeAccountId(zernioProfileId, platform);
  s.accounts.set(zernioAccountId, { zernioAccountId, zernioProfileId, platform, handle: `fake_${platform}`, avatarUrl: null });
  const url = new URL(returnUrl);
  url.searchParams.set("connected", platform);
  url.searchParams.set("accountId", zernioAccountId);
  return { url: url.toString() };
}

function post(deliverable: PublishDeliverable, slot: PublishSlot, confirm: "now" | "webhook"): PublishResult {
  const s = state();
  const done = s.posts.get(slot.idempotencyKey);
  if (done) return done;
  const account = s.accounts.get(slot.zernioAccountId);
  let result: PublishResult;
  if (!account || account.platform !== slot.platform) {
    result = { status: "failed", externalId: null, url: null, error: { code: "not_found", message: `Your ${PLATFORM_LABEL[slot.platform]} account is no longer connected. Connect it again in Settings.`, retryable: false } };
  } else if (deliverable.text.includes("[fake:down]")) {
    // Not remembered under the key: Zernio did not take it, so a retry may post.
    return { status: "failed", externalId: null, url: null, error: { code: "unavailable", message: "The posting service did not answer. Try again in a few minutes.", retryable: true } };
  } else if (deliverable.text.includes("[fake:invalid]")) {
    result = { status: "failed", externalId: null, url: null, error: { code: "invalid", message: `${PLATFORM_LABEL[slot.platform]} refused this post. Edit it and approve it again.`, retryable: false } };
  } else {
    s.calls.publish += 1;
    const externalId = id("fake_post", slot.idempotencyKey);
    result =
      confirm === "now"
        ? { status: "published", externalId, url: `https://example.com/${slot.platform}/${externalId}`, error: null }
        : { status: "accepted", externalId, url: null, error: null };
  }
  s.posts.set(slot.idempotencyKey, result);
  return result;
}

export function createFakePublishAdapter(options: FakeOptions = {}): PublishAdapter {
  const confirm = options.confirm ?? "now";
  const uploadBase = (options.uploadBase ?? "http://127.0.0.1:8789").replace(/\/+$/, "");
  return {
    name: "fake",
    async createProfile(userId) {
      const zernioProfileId = id("fake_prof", userId);
      state().profiles.add(zernioProfileId);
      return { zernioProfileId };
    },
    async connectLink(zernioProfileId, platform, returnUrl) {
      return connect(zernioProfileId, platform, returnUrl);
    },
    async accounts(zernioProfileId) {
      return [...state().accounts.values()]
        .filter((a) => a.zernioProfileId === zernioProfileId)
        .map(({ zernioAccountId, platform, handle, avatarUrl }) => ({ zernioAccountId, platform, handle, avatarUrl }));
    },
    async disconnect(zernioAccountId) {
      state().accounts.delete(zernioAccountId);
    },
    async creatorInfo(zernioAccountId): Promise<CreatorInfo> {
      const account = state().accounts.get(zernioAccountId);
      if (!account) throw new PublishError("not_found", "This TikTok account is no longer connected.", false);
      if (account.platform !== "tiktok") throw new PublishError("invalid", "Creator info is for TikTok accounts only.", false);
      return {
        nickname: account.handle,
        avatarUrl: account.avatarUrl,
        canPostMore: true,
        privacyLevels: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
        maxVideoSeconds: 600,
        commentEnabled: true,
        duetEnabled: true,
        stitchEnabled: false,
      };
    },
    async presignMedia(file) {
      const key = id("fake_media", file.filename, String(file.bytes));
      return { uploadUrl: `${uploadBase}/upload/${key}`, publicUrl: `https://media.example.com/${key}`, expiresInSeconds: 3600 };
    },
    async publish(deliverable, slot) {
      return post(PublishDeliverableSchema.parse(deliverable), PublishSlotSchema.parse(slot), confirm);
    },
  };
}
