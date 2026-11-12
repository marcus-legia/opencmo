/**
 * The Zernio client against a fake `fetch` shaped like Zernio's OpenAPI: no network, no key. Covers the
 * request each call sends, the one retry on a 5xx for repeatable calls only, error mapping to the card's
 * words, and the post result for published, pending and refused.
 *
 *     cd apps/web && npx tsx lib/departments/publish/zernio.check.ts
 */
import assert from "node:assert/strict";

import { publishAdapter } from "./adapter";
import { PublishError, type PublishDeliverable, type PublishSlot } from "./types";
import { createZernioAdapter, platformReason, postBody, zernioError } from "./zernio";

type Seen = { method: string; url: string; headers: Record<string, string>; body: unknown };
type Reply = { status: number; body?: unknown } | "drop";

function fakeFetch(replies: Reply[]) {
  const seen: Seen[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      method: init?.method ?? "GET",
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected call ${init?.method} ${String(input)}`);
    if (r === "drop") throw new TypeError("fetch failed");
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { f, seen };
}

const ACC = "acc_tt1";
const post: PublishDeliverable = {
  id: "00000000-0000-4000-8000-0000000000a1",
  kind: "short",
  text: "How I cut my editing time in half",
  title: null,
  media: [{ url: "https://media.zernio.com/temp/1_a_short.mp4", contentType: "video/mp4" }],
};
const slot: PublishSlot = {
  id: "00000000-0000-4000-8000-0000000000b1",
  platform: "tiktok",
  zernioAccountId: ACC,
  idempotencyKey: "slot:00000000-0000-4000-8000-0000000000b1:1",
  publishAt: "2026-11-02T09:00:00Z",
  fields: { platform: "tiktok", privacy: "SELF_ONLY", allowComment: true, allowDuet: null, allowStitch: false, brandOrganic: true, brandContent: false, aiGenerated: true },
};

async function main() {
  // The key alone never posts: production's `.env.local` has it.
  assert.throws(() => publishAdapter({ ZERNIO_API_KEY: "sk" }), (e: unknown) => e instanceof PublishError && e.code === "not_configured");
  assert.equal(publishAdapter({ ZERNIO_API_KEY: "sk", OPENCMO_PUBLISH_LIVE: "1" }).name, "zernio");

  // Profile: found again by our external id; made once otherwise, with an idempotency key.
  {
    const { f, seen } = fakeFetch([{ status: 200, body: { profiles: [] } }, { status: 201, body: { profile: { _id: "prof_1" } } }]);
    const z = createZernioAdapter({ apiKey: "sk_test", fetch: f });
    assert.deepEqual(await z.createProfile("user-1"), { zernioProfileId: "prof_1" });
    assert.equal(seen[0]!.headers.Authorization, "Bearer sk_test");
    assert.ok(seen[0]!.url.startsWith("https://zernio.com/api/v1/profiles?externalId=opencmo%3Auser-1"));
    assert.equal(seen[1]!.headers["Idempotency-Key"], "profile:user-1");
    assert.equal((seen[1]!.body as { externalId: string }).externalId, "opencmo:user-1");
    // Zernio ignoring the filter must not hand us another founder's profile.
    const loose = fakeFetch([{ status: 200, body: { profiles: [{ _id: "prof_other", externalId: "opencmo:user-2" }] } }, { status: 201, body: { profile: { _id: "prof_mine" } } }]);
    assert.deepEqual(await createZernioAdapter({ apiKey: "k", fetch: loose.f }).createProfile("user-1"), { zernioProfileId: "prof_mine" });
    const found = fakeFetch([{ status: 200, body: { profiles: [{ _id: "prof_1", externalId: "opencmo:user-1" }] } }]);
    assert.deepEqual(await createZernioAdapter({ apiKey: "k", fetch: found.f }).createProfile("user-1"), { zernioProfileId: "prof_1" });
    const again = fakeFetch([{ status: 200, body: { profiles: [] } }, { status: 409, body: { details: { existingProfileId: "prof_1" } } }]);
    assert.deepEqual(await createZernioAdapter({ apiKey: "k", fetch: again.f }).createProfile("user-1"), { zernioProfileId: "prof_1" });
  }

  // Connect: X is `twitter` at Zernio; the link must be https.
  {
    const { f, seen } = fakeFetch([{ status: 200, body: { authUrl: "https://x.com/i/oauth2/authorize?state=s" } }]);
    const z = createZernioAdapter({ apiKey: "k", fetch: f });
    assert.equal((await z.connectLink("prof_1", "x", "https://opencmo.io/api/v1/accounts/callback")).url, "https://x.com/i/oauth2/authorize?state=s");
    const u = new URL(seen[0]!.url);
    assert.equal(u.pathname, "/api/v1/connect/twitter");
    assert.equal(u.searchParams.get("redirect_url"), "https://opencmo.io/api/v1/accounts/callback");
    const bad = fakeFetch([{ status: 200, body: { authUrl: "javascript:alert(1)" } }]);
    await assert.rejects(createZernioAdapter({ apiKey: "k", fetch: bad.f }).connectLink("prof_1", "x", "https://a.b/c"));
  }

  // Accounts: only active ones of this profile on our platforms; a non-https avatar is dropped.
  {
    const { f } = fakeFetch([
      {
        status: 200,
        body: {
          accounts: [
            { _id: "acc_x", platform: "twitter", profileId: "prof_1", username: "founder", profilePicture: "https://pbs.twimg.com/a.jpg", isActive: true },
            { _id: "acc_tt", platform: "tiktok", profileId: "prof_1", displayName: "Founder", profilePicture: "http://insecure/a.jpg", isActive: true },
            { _id: "acc_fb", platform: "facebook", profileId: "prof_1", username: "page", isActive: true },
            { _id: "acc_old", platform: "threads", profileId: "prof_1", username: "old", isActive: false },
            { _id: "acc_other", platform: "linkedin", profileId: "prof_2", username: "someone", isActive: true },
          ],
        },
      },
    ]);
    assert.deepEqual(await createZernioAdapter({ apiKey: "k", fetch: f }).accounts("prof_1"), [
      { zernioAccountId: "acc_x", platform: "x", handle: "founder", avatarUrl: "https://pbs.twimg.com/a.jpg" },
      { zernioAccountId: "acc_tt", platform: "tiktok", handle: "Founder", avatarUrl: null },
      // A Facebook Page (D9, 2026-11-12): the founder picked the Page in Zernio's connect flow.
      { zernioAccountId: "acc_fb", platform: "facebook", handle: "page", avatarUrl: null },
    ]);
  }

  // Disconnect: one retry on a 5xx (a delete repeats safely); already gone is fine.
  {
    const { f, seen } = fakeFetch([{ status: 502 }, { status: 404, body: { error: "not found" } }]);
    await createZernioAdapter({ apiKey: "k", fetch: f }).disconnect("acc_x");
    assert.deepEqual(seen.map((s) => s.method), ["DELETE", "DELETE"]);
  }

  // Creator info: privacy levels the account allows, toggles turned off in the app, duet null for photos.
  {
    const { f } = fakeFetch([
      {
        status: 200,
        body: {
          creator: { nickname: "founder", avatarUrl: "https://p16.tiktokcdn.com/a.jpg", canPostMore: false },
          privacyLevels: [{ value: "PUBLIC_TO_EVERYONE" }, { value: "SELF_ONLY" }, { value: "SOMETHING_NEW" }],
          postingLimits: { maxVideoDurationSec: 600, interactionSettings: { allow_comment: { enabled: true }, allow_duet: null, allow_stitch: { enabled: false } } },
        },
      },
    ]);
    assert.deepEqual(await createZernioAdapter({ apiKey: "k", fetch: f }).creatorInfo(ACC), {
      nickname: "founder",
      avatarUrl: "https://p16.tiktokcdn.com/a.jpg",
      canPostMore: false,
      privacyLevels: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      maxVideoSeconds: 600,
      commentEnabled: true,
      duetEnabled: null,
      stitchEnabled: false,
    });
  }

  // Post body: publish now, the slot's key, TikTok's approved fields, the slot id for the webhook.
  {
    const body = postBody(post, slot) as Record<string, unknown>;
    assert.equal(body.publishNow, true);
    assert.equal("scheduledFor" in body, false, "we fire at the approved time; Zernio's scheduler is not used");
    assert.deepEqual(body.platforms, [
      {
        platform: "tiktok",
        accountId: ACC,
        platformSpecificData: {
          privacyLevel: "SELF_ONLY",
          allowComment: true,
          allowStitch: false,
          videoMadeWithAi: true,
          commercialContentType: "brand_organic",
          contentPreviewConfirmed: true,
          expressConsentGiven: true,
        },
      },
    ]);
    assert.deepEqual(body.mediaItems, [{ url: post.media[0]!.url, type: "video" }]);
    assert.deepEqual(body.metadata, { opencmoSlotId: slot.id, opencmoDeliverableId: post.id });
    const yt = postBody({ ...post, title: "Half the editing time" }, { ...slot, platform: "youtube", fields: { platform: "youtube", aiGenerated: false } }) as {
      platforms: { platformSpecificData: unknown }[];
    };
    assert.deepEqual(yt.platforms[0]!.platformSpecificData, { title: "Half the editing time", containsSyntheticMedia: false });
    const x = postBody({ ...post, kind: "post", media: [] }, { ...slot, platform: "x", fields: { platform: "x", aiGenerated: false } }) as { platforms: object[] };
    assert.deepEqual(x.platforms[0], { platform: "twitter", accountId: ACC });
    // A Facebook Page post: Zernio's slug is ours and the Page is the account, no page id in the body.
    const fb = postBody({ ...post, kind: "post", media: [], text: "x".repeat(4000) }, { ...slot, platform: "facebook", fields: { platform: "facebook", aiGenerated: false } }) as { content: string; platforms: object[] };
    assert.deepEqual([fb.platforms[0], fb.content.length], [{ platform: "facebook", accountId: ACC }, 4000], "a long Facebook post goes as one");

    // A photo post (D7): every photo as an image, in order; TikTok gets Photo Mode in a top-level `tiktokSettings`.
    const photos = [1, 2, 3].map((i) => ({ url: `https://storage.example/p/${i}.jpg`, contentType: "image/jpeg" as const }));
    const photoPost = { ...post, kind: "photo_post" as const, text: "Demo day, in three photos.", media: photos };
    const tt = postBody(photoPost, slot) as { mediaItems: unknown; platforms: object[]; tiktokSettings: Record<string, unknown> };
    assert.deepEqual(tt.mediaItems, photos.map((p) => ({ url: p.url, type: "image" })), "every photo as an image");
    assert.deepEqual(tt.platforms, [{ platform: "tiktok", accountId: ACC }]);
    assert.deepEqual([tt.tiktokSettings.mediaType, tt.tiktokSettings.photoCoverIndex, tt.tiktokSettings.description, tt.tiktokSettings.privacyLevel], ["photo", 0, "Demo day, in three photos.", "SELF_ONLY"]);
    const ig = postBody(photoPost, { ...slot, platform: "instagram", fields: { platform: "instagram", aiGenerated: false } }) as { mediaItems: unknown[]; tiktokSettings?: unknown };
    assert.deepEqual([ig.mediaItems.length, "tiktokSettings" in ig], [3, false], "an Instagram carousel is the images alone");

    // A Threads post over 500 characters goes out as a chain, the image on its first part; 500 or under is one post.
    type Chain = { content?: string; mediaItems?: unknown; platforms: { platform: string; platformSpecificData?: { threadItems: { content: string; mediaItems?: unknown }[] } }[] };
    const long = `${"One sentence that fills the post up. ".repeat(24)}`.trim();
    assert.ok([...long].length > 800 && [...long].length <= 1000);
    const image = [{ url: "https://media.zernio.com/temp/1_a.png", contentType: "image/png" as const }];
    const threadsSlot = { ...slot, platform: "threads" as const, fields: { platform: "threads" as const, aiGenerated: false } };
    const chain = postBody({ ...post, kind: "post", text: long, media: image }, threadsSlot) as Chain;
    const items = chain.platforms[0]!.platformSpecificData!.threadItems;
    assert.equal(items.length, 2);
    assert.ok(items.every((item) => [...item.content].length <= 500));
    assert.equal(items.map((item) => item.content).join(" "), long);
    assert.deepEqual(items.map((item) => Boolean(item.mediaItems)), [true, false]);
    assert.equal(chain.mediaItems, undefined);
    const short = postBody({ ...post, kind: "post", text: "x".repeat(500), media: [] }, threadsSlot) as Chain;
    assert.equal(short.platforms[0]!.platformSpecificData, undefined);
    // X takes a long post as one (X Premium); a thread only when the founder asked for one after a refusal.
    const xSlot = { ...slot, platform: "x" as const, fields: { platform: "x" as const, aiGenerated: false } };
    const one = postBody({ ...post, kind: "post", text: long, media: [] }, xSlot) as Chain;
    assert.equal(one.platforms[0]!.platformSpecificData, undefined);
    assert.equal(one.content, long);
    const asked = postBody({ ...post, kind: "post", text: long, media: [] }, { ...xSlot, fields: { ...xSlot.fields, asThread: true } }) as Chain;
    assert.ok(asked.platforms[0]!.platformSpecificData!.threadItems.length >= 4);
    assert.ok(asked.platforms[0]!.platformSpecificData!.threadItems.every((item) => [...item.content].length <= 280));
    // A video's caption is never cut into a chain.
    const caption = postBody({ ...post, text: long }, { ...slot, platform: "threads", fields: { platform: "threads", aiGenerated: false } }) as Chain;
    assert.equal(caption.platforms[0]!.platformSpecificData, undefined);
  }

  // Publish: published now, retried once on a 5xx with the same key, pending → accepted, refused → failed.
  {
    const { f, seen } = fakeFetch([
      { status: 503, body: { code: "temporarily_unavailable" } },
      { status: 201, body: { post: { _id: "post_1", status: "published", platforms: [{ accountId: ACC, status: "published", platformPostId: "7300", platformPostUrl: "https://www.tiktok.com/@founder/video/7300" }] } } },
    ]);
    const res = await createZernioAdapter({ apiKey: "k", fetch: f }).publish(post, slot);
    assert.deepEqual(res, { status: "published", externalId: "7300", url: "https://www.tiktok.com/@founder/video/7300", error: null });
    assert.deepEqual(seen.map((s) => s.headers["Idempotency-Key"]), [slot.idempotencyKey, slot.idempotencyKey]);

    const pending = fakeFetch([{ status: 201, body: { post: { _id: "post_2", status: "publishing", platforms: [{ accountId: ACC, status: "processing" }] } } }]);
    assert.deepEqual(await createZernioAdapter({ apiKey: "k", fetch: pending.f }).publish(post, slot), { status: "accepted", externalId: "post_2", url: null, error: null });

    const refused = fakeFetch([{ status: 207, body: { post: { _id: "post_3", status: "failed", platforms: [{ accountId: ACC, status: "failed", errorMessage: "Video too long\nfor this account" }] } } }]);
    const r = await createZernioAdapter({ apiKey: "k", fetch: refused.f }).publish(post, slot);
    assert.ok(r.status === "failed" && r.error.message === "TikTok refused the post: Video too long for this account");

    const gone = fakeFetch([{ status: 403, body: { code: "ACCOUNT_DISCONNECTED" } }]);
    const g = await createZernioAdapter({ apiKey: "k", fetch: gone.f }).publish(post, slot);
    assert.ok(g.status === "failed" && g.error.code === "not_found" && !g.error.retryable);

    // A dropped connection on a keyed post is retried once; twice → a retryable failure for the card.
    const dropped = fakeFetch(["drop", "drop"]);
    const d = await createZernioAdapter({ apiKey: "k", fetch: dropped.f }).publish(post, slot);
    assert.ok(d.status === "failed" && d.error.code === "unavailable" && d.error.retryable);
    assert.equal(dropped.seen.length, 2);

    // Nothing to post (empty text): a refusal for the card, nothing sent (review #4).
    const none = fakeFetch([]);
    const e = await createZernioAdapter({ apiKey: "k", fetch: none.f }).publish({ ...post, text: "  ", media: [] }, { ...slot, platform: "x", fields: { platform: "x", aiGenerated: false } });
    assert.ok(e.status === "failed" && e.error.code === "invalid" && !e.error.retryable);
    assert.equal(none.seen.length, 0);
  }

  // Presign: the worker's size cap, a filename Zernio accepts, https URLs only.
  {
    const { f, seen } = fakeFetch([{ status: 200, body: { uploadUrl: "https://b.r2.cloudflarestorage.com/temp/1_a.mp4?X-Amz-Signature=s", publicUrl: "https://media.zernio.com/temp/1_a.mp4", expiresIn: 3600 } }]);
    const z = createZernioAdapter({ apiKey: "k", fetch: f });
    const p = await z.presignMedia({ filename: "my short (1).mp4", contentType: "video/mp4", bytes: 1000 });
    assert.equal(p.publicUrl, "https://media.zernio.com/temp/1_a.mp4");
    assert.deepEqual(seen[0]!.body, { filename: "my_short_1_.mp4", contentType: "video/mp4", size: 1000 });
    await assert.rejects(z.presignMedia({ filename: "a.mp4", contentType: "video/mp4", bytes: 3 * 1024 ** 3 }));
  }

  // Error mapping keeps our words; a platform's reason is trimmed and flattened.
  assert.equal(zernioError(401, { code: "invalid_credentials" }, "posting").code, "not_configured");
  assert.equal(zernioError(401, { code: "reconnect_required" }, "posting").code, "auth");
  assert.equal(zernioError(429, {}, "posting").retryable, true);
  assert.equal(zernioError(409, { code: "idempotency_conflict" }, "posting").code, "unavailable");
  assert.equal(zernioError(409, { details: { existingPostId: "p" } }, "posting").code, "invalid");
  assert.ok(!zernioError(500, "<html>sk_live_secret</html>", "posting").message.includes("sk_live"));
  assert.equal(platformReason("x".repeat(300))!.length, 200);

  console.log("zernio client checks passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
