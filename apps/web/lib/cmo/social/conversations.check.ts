/**
 * The shared shape of a Sales conversation: the platform list and URL normalisation (Sales finder A1).
 *
 *     cd apps/web && npx tsx lib/cmo/social/conversations.check.ts
 */
import assert from "node:assert/strict";

import { PLATFORM_LABEL, SALES_PLATFORMS, normalizeConversationUrl, parsePlatforms } from "./conversations";

assert.deepEqual([...SALES_PLATFORMS], ["reddit", "hn", "facebook", "threads"]);
assert.equal(PLATFORM_LABEL.facebook, "Facebook groups");

// One post, one URL: the two Threads domains, tracking params and fragments collapse to the same string.
assert.equal(normalizeConversationUrl("https://www.threads.net/@a/post/XYZ?xmt=1#c"), "https://www.threads.com/@a/post/XYZ");
assert.equal(normalizeConversationUrl("https://threads.com/@a/post/XYZ"), "https://www.threads.com/@a/post/XYZ");
assert.equal(normalizeConversationUrl("https://WWW.Facebook.com/groups/123/posts/456/?__cft__=x"), "https://www.facebook.com/groups/123/posts/456/");
assert.equal(normalizeConversationUrl("https://m.facebook.com/groups/123/permalink/456/"), "https://www.facebook.com/groups/123/permalink/456/");
assert.equal(normalizeConversationUrl("https://www.reddit.com/r/SaaS/comments/1abc/title/"), "https://www.reddit.com/r/SaaS/comments/1abc/title/");
// Hacker News keeps its query: the item id lives there.
assert.equal(normalizeConversationUrl("https://news.ycombinator.com/item?id=123#x"), "https://news.ycombinator.com/item?id=123");

// Anything else is not a conversation we store or show.
assert.equal(normalizeConversationUrl("http://reddit.com/r/x/comments/1/t/"), null, "https only");
assert.equal(normalizeConversationUrl("https://evil.example/r/x"), null, "host allowlist");
assert.equal(normalizeConversationUrl("https://www.facebook.com.evil.example/groups/1/posts/2/"), null, "no suffix tricks");
assert.equal(normalizeConversationUrl("https://user:pw@www.reddit.com/r/x/"), null, "no credentials");
assert.equal(normalizeConversationUrl("not a url"), null);

assert.deepEqual(parsePlatforms(["threads", "x", "reddit", "reddit"]), ["reddit", "threads"]);
assert.deepEqual(parsePlatforms("reddit"), []);
assert.deepEqual(parsePlatforms(null), []);
assert.deepEqual(parsePlatforms(["hn", 3, "facebook"]), ["hn", "facebook"]);

console.log("conversations.check: ok");
