/**
 * Writer's pure parts: the contract (kinds, the video brief shared with Studio); W0's post rules (no links,
 * no hashtags) and No AI Slop as guidance read by the writer, the checker, sales and CMO chat; W1's posts per
 * platform profile (one writer agent each, one cached prefix, checks from `platforms.json`); W2's voice notes; W3's
 * runs for Studio (video brief, captions per profile, YouTube text, slides) on the fake provider.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/writer/writer.check.ts
 */
import assert from "node:assert/strict";

import { VideoBriefSchema as StudioBriefSchema } from "@/lib/departments/studio/types";
import { briefRequest } from "@/lib/departments/studio/video";

import { AGENT_SPECS, CAPTION_WRITERS, POST_WRITERS } from "../agents/registry";
import { checkPost } from "../jobs/check-post";
import { REVIEW_SYSTEM } from "../jobs/draft-post";
import { postProfile } from "../platforms";
import { memoryStore } from "../jobs/memory-store";
import { seedLibrary } from "../jobs/eval/library";
import { drainCmoQueue, type JobContext } from "../jobs/runner";
import { CMO_JOB_KINDS, isoDay, type ItemRow } from "../jobs/types";
import { stockPatterns } from "../jobs/eval/style";
import { CAPTION_PROFILES, countHashtags, POST_PROFILES, profileOf } from "../platforms";
import { CMO_SKILLS } from "../skills/index.gen";
import { skillIndex } from "../skills";

import { captionText, checkCaption, checkPostFor, checkYoutube, cleanHashtags, moreAdvice } from "./checks";
import { profileBlock, profileFromPrompt, voiceBlock, writerData } from "./context";
import { createWriter, type WriterThink } from "./draft";
import { writerAgent } from "./jobs";
import { firstLine } from "./video-source";
import { CAPTION_SYSTEM, YOUTUBE_SYSTEM } from "./prompts";
import { PROFILE_KIND, VideoBriefSchema, WRITER_KINDS, type WriterContext, type WriterProfile } from "./types";

assert.equal(StudioBriefSchema, VideoBriefSchema, "Studio takes Writer's video brief, not a copy");
assert.deepEqual(Object.keys(PROFILE_KIND).sort(), [...WRITER_KINDS].sort(), "every kind says which profile it drafts for");

const brief = VideoBriefSchema.parse({ objective: "Show founders a demo video made from one slash command", hooks: ["What if your demo made itself?"] });
assert.deepEqual([brief.cta, brief.angle, brief.seconds, brief.aspect], ["", "", 30, "9:16"], "an older brief without a call to action still parses");
assert.doesNotMatch(briefRequest(brief).prompt, /call to action/, "no call to action line when the brief has none");
const withCta = VideoBriefSchema.parse({ ...brief, cta: "Try /video on your own demo" });
assert.match(briefRequest(withCta).prompt, /End with this call to action: Try \/video on your own demo/, "the Director reads the brief's call to action");

// W0: no links and no hashtags in a post; tech names, "#1" and "C#" are neither.
const rules = { avoid: [], known: new Set<string>() };
for (const text of ["Read more at https://example.com", "Details on www.example.com", "Try ferreto.io/pricing today", "Our docs live at Paylane.app"]) {
  assert.ok(checkPost(text, rules).some((issue) => issue.includes("link")), `a link is refused: ${text}`);
}
for (const text of ["Shipping this week #buildinpublic", "#saas tip of the day", "We ship.\n#indiehackers"]) {
  assert.ok(checkPost(text, rules).some((issue) => issue.includes("hashtag")), `a hashtag is refused: ${text}`);
}
for (const text of ["We moved the app to Next.js and Node.js.", "Our #1 rule is to answer within a day.", "I wrote it in C# first.", "Ship it. Then measure."]) {
  assert.deepEqual(checkPost(text, rules), [], `not a link or a hashtag: ${text}`);
}

// No AI Slop is a skill read by the writer, the checker, sales and CMO chat; its plain stock patterns are also a code
// gate (lib/cmo/slop.ts, checked in slop.check.ts).
assert.deepEqual([...CMO_SKILLS["no-ai-slop"].agents].sort(), ["checker", "cmo", "director", "facebook_writer", "linkedin_writer", "onboarding", "planner", "research", "sales", "shorts", "threads_writer", "writer", "x_writer", "youtube_writer"]);
assert.match(CMO_SKILLS["no-ai-slop"].license, /MIT — Copyright \(c\) 2026 Peter Yang/);
for (const agent of ["x_writer", "checker", "sales", "cmo"] as const) assert.ok(skillIndex(agent).includes("- no-ai-slop:"), `${agent} lists no-ai-slop`);
assert.ok(REVIEW_SYSTEM.includes('<skill name="no-ai-slop">') && /reads like AI wrote it/.test(REVIEW_SYSTEM), "the checker fails a draft that reads as AI");
const body = CMO_SKILLS["no-ai-slop"].body;
const words = body.split(/\s+/).filter(Boolean).length;
assert.ok(words >= 1400 && words <= 2000, `about 1,700 words (got ${words})`);
for (const left of ["What changed", "Two jobs", "What to ask for", "ask them to paste"]) assert.ok(!body.includes(left), `its chat parts stay out: ${left}`);
const postSkill = CMO_SKILLS["post"].body;
// The old x-writing taught fill-in hook formulas and a closing question; the post skill teaches neither.
for (const taught of ["isn't what you think", "is wrong. Here's why:", "the last post sums up", "1-2 hashtags", "link in reply", "I was wrong about [", "Do this instead:", "a question, a takeaway"]) {
  assert.ok(!postSkill.includes(taught), `the post skill does not teach: ${taught}`);
}
assert.deepEqual([...CMO_SKILLS["post"].agents].sort(), ["checker", "cmo", "facebook_writer", "linkedin_writer", "threads_writer", "x_writer"], "one post skill for every post writer");

// The eval's stock-pattern measure: catches the old fake drafts, passes the new ones and plain posts.
assert.deepEqual(stockPatterns("Most founders skip this: polite reminders get invoices paid."), ["faux_insight", "colon_reveal"]);
assert.deepEqual(stockPatterns("A small thing we changed in Paylane: reminders on day 3."), ["colon_reveal"]);
assert.deepEqual(stockPatterns("The question isn't the model. It's the eval."), ["binary_contrast"]);
assert.deepEqual(stockPatterns("Reminders work.\n\nUltimately, consistency wins."), ["recap_ending"]);
assert.deepEqual(stockPatterns("We ship daily — and it shows."), ["em_dash"]);
for (const clean of [
  "Why polite reminders on day 3, 7 and 14 get invoices paid.\n\nWe learned it building Paylane this week.",
  "We tried the usual advice first and it did not work for us. Why polite reminders on day 3, 7 and 14 get invoices paid.",
  "We changed one small thing in Paylane this week. Why polite reminders on day 3, 7 and 14 get invoices paid.",
  "How to get paid without chasing:\n1. Send the invoice the day the work ends.",
  "Overall revenue grew after we added reminders.",
]) assert.deepEqual(stockPatterns(clean), [], `clean: ${clean}`);

// Writer core: code checks per kind and profile.
const profile = (id: string): WriterProfile => {
  const found = profileOf(id);
  assert.ok(found, `profile ${id}`);
  return found;
};
/** A caption profile for the checks: the caption kind is generic (TikTok and Instagram left in wave 4b). */
const captionA: WriterProfile = { id: "caption_a", label: "Short caption", platform: "youtube", kind: "caption", limit: 2200, title: null, visibleBeforeMore: 100, hashtags: 5, links: false, tone: "Short." } as WriterProfile;
const captionB: WriterProfile = { ...captionA, id: "caption_b", label: "Long caption" };
const youtube = profile("youtube");
const threads = profile("threads");
const caption3: WriterProfile = { ...captionA, hashtags: 3 };
assert.deepEqual(cleanHashtags(["#BuildInPublic", "buildinpublic", " #saas ", "#", "#1", "build in public"]), ["BuildInPublic", "saas"], "one tag per word, no empty or number-only tags");
assert.equal(captionText({ text: "Hook line ", hashtags: ["saas", "#founder"] }), "Hook line\n\n#saas #founder");
assert.deepEqual(checkCaption({ text: "Hook line", hashtags: ["a1", "b", "c", "d", "e", "f"] }, captionA, rules), ["It has 6 hashtags; the Short caption takes at most 5."]);
assert.deepEqual(checkCaption({ text: "Hook #saas line", hashtags: ["b", "c", "d"] }, caption3, rules), ["It has 4 hashtags; the Short caption takes at most 3."], "tags in the text count too");
assert.ok(checkCaption({ text: "See paylane.app", hashtags: [] }, captionA, rules).some((issue) => issue.includes("link")));
// The founder's product may be named like a domain: its bare name is not a link; any other domain, or a path, is.
const calRules = { ...rules, names: ["Cal.com"] };
assert.deepEqual(checkCaption({ text: "Booked in a minute with Cal.com.", hashtags: [] }, captionA, calRules), [], "the product's own name");
assert.ok(checkCaption({ text: "Booked with Cal.com, see acme.io", hashtags: [] }, captionA, calRules).some((issue) => issue.includes("link")), "another domain");
assert.ok(checkCaption({ text: "Pricing at cal.com/pricing", hashtags: [] }, captionA, calRules).some((issue) => issue.includes("link")), "a path");
assert.ok(checkPost("We shipped it on Cal.com today.", calRules).every((issue) => !issue.includes("link")), "a post may name the product");
assert.deepEqual(checkCaption({ text: "Built on Next.js and Node.js.", hashtags: [] }, captionA, rules), [], "a framework is not a link");
assert.ok(checkCaption({ text: "x".repeat(2195), hashtags: ["saas"] }, captionA, rules)[0]?.includes("2202 characters"), "the limit counts the published caption with its hashtags");
assert.deepEqual(checkYoutube({ title: "How Paylane chases late invoices", description: "A walk through.", hashtags: ["saas"] }, youtube, rules), []);
assert.ok(checkYoutube({ title: "t".repeat(101), description: "d", hashtags: [] }, youtube, rules)[0]?.includes("101 characters"));
assert.ok(checkYoutube({ title: "Late invoices #saas", description: "d", hashtags: [] }, youtube, rules).some((issue) => issue.includes("title has a hashtag")));

// The data after the cached prefix: profile, then the founder's rules, then their voice (newest, heaviest first).
assert.match(profileBlock(threads), /platform: threads \(Threads\)[\s\S]*limit: 500 characters[\s\S]*hashtags: none[\s\S]*links: none/);
assert.match(profileBlock(youtube), /title limit: 100 characters; description limit: 5000 characters/);
// Owner, 2026-11-24: LinkedIn posts aim for 100 to 200 words; X and Threads keep their character limits only.
assert.match(profileBlock(profileOf("linkedin")!), /length: 100 to 200 words, in short paragraphs/);
assert.doesNotMatch(profileBlock(profileOf("x")!), /length:/);
assert.doesNotMatch(profileBlock(threads), /length:/);
const voice = voiceBlock([
  { body: "Old note", platform: "x", weight: 0.2, createdAt: "2026-09-01T00:00:00Z" },
  { body: "Cuts the last line", platform: "linkedin", weight: 0.9, createdAt: "2026-10-20T00:00:00Z" },
]);
assert.ok(voice.indexOf("Cuts the last line") < voice.indexOf("Old note"), "heavier notes first");
assert.match(voice, /- \(LinkedIn, weight 0\.90, 2026-10-20\) Cuts the last line/, "each note says its platform and weight");
const ctx: WriterContext = {
  documents: { product: { name: "Paylane", pricing: "$12/month" }, brand: { avoid: ["revolutionary"] } },
  corrections: ["Never end with a summary line."],
  voiceNotes: [{ body: "Writes in lowercase", platform: "threads", weight: 1, createdAt: "2026-10-28T00:00:00Z" }],
  recent: [],
};
const data = writerData(ctx, threads, "BRIEF");
assert.ok(data.indexOf("<platform>") < data.indexOf("<founder_rules") && data.indexOf("<founder_rules") < data.indexOf("<founder_voice") && data.indexOf("<founder_voice") < data.indexOf("<documents>") && data.endsWith("BRIEF"));
for (const system of [CAPTION_SYSTEM, YOUTUBE_SYSTEM]) {
  assert.ok(system.includes('<skill name="no-ai-slop">'), "every writer kind reads No AI Slop");
}

// draft(): the same prefix for every profile of a kind; one fix round; what still fails never reaches a card.
type Call = { agent: string; system: string; prompt: string; label: string };
function scripted(answers: unknown[]): { think: WriterThink; calls: Call[] } {
  const calls: Call[] = [];
  const think: WriterThink = async (opts) => {
    calls.push({ agent: opts.agent, system: opts.system, prompt: opts.prompt, label: opts.label });
    if (!answers.length) throw new Error("no scripted answer left");
    return opts.schema.parse(answers.shift());
  };
  return { think, calls };
}
const video = { clipId: "c1", kind: "short" as const, title: "Chasing late invoices", hook: "Your invoice is 14 days late.", transcript: "Your invoice is 14 days late. Paylane sends the reminder.", seconds: 32 };

async function writerChecks() {
  const caption = { text: "Your invoice is 14 days late.\n\nPaylane sends the reminder for you.", hashtags: ["#freelancer", "invoicing"], rationale: "Leads with the hook." };
  const run = scripted([caption, caption]);
  const writer = createWriter({ think: run.think, agentFor: () => "x_writer", canFix: true });
  const ig = await writer.draft("caption", captionA, { video }, ctx);
  assert.deepEqual(ig.hashtags, ["freelancer", "invoicing"], "hashtags cleaned, the 14 from the transcript is a known number");
  await writer.draft("caption", captionB, { video }, ctx);
  assert.equal(run.calls[0]!.system, run.calls[1]!.system, "one cached prefix for every caption profile");
  assert.ok(run.calls[0]!.prompt.includes("platform: caption_a") && run.calls[1]!.prompt.includes("platform: caption_b"));

  // A failed code check gets one fix round with the reasons; the fixed caption is kept.
  const tooMany = { ...caption, hashtags: ["a1", "b1", "c1", "d1", "e1", "f1"] };
  const fixed = scripted([tooMany, caption]);
  const out = await createWriter({ think: fixed.think, agentFor: () => "x_writer", canFix: true }).draft("caption", captionA, { video }, ctx);
  assert.equal(fixed.calls.length, 2);
  assert.match(fixed.calls[1]!.prompt, /<problems>It has 6 hashtags; the Short caption takes at most 5\.<\/problems>/);
  assert.equal(fixed.calls[1]!.label, "write_caption_caption_a_fix");
  assert.deepEqual(out.hashtags, ["freelancer", "invoicing"]);

  // Still failing after the fix (or no fix allowed): the run fails with the reasons, no card.
  const stuck = scripted([tooMany]);
  await assert.rejects(createWriter({ think: stuck.think, agentFor: () => "x_writer", canFix: false }).draft("caption", captionA, { video }, ctx), /failed our checks\. It has 6 hashtags/);

  // Posts: the versions that pass the code are kept; a link or hashtag drops a version, never the style.
  const post = { versions: [{ text: "We send the reminder on day 3.", angle: "a" }, { text: "Try it at paylane.app", angle: "b" }, { text: "Day 7 is the second nudge #saas", angle: "c" }], rationale: "r" };
  const posted = await createWriter({ think: scripted([post]).think, agentFor: () => "x_writer", canFix: false, postSystem: "POST SYSTEM" }).draft("post", threads, { idea: "Reminders" }, ctx);
  assert.deepEqual(posted.versions.map((v) => v.angle), ["a"]);

  // The checker's review joins the fix round; on its own it never drops a version.
  const reviewed = scripted([{ ...post, versions: [post.versions[0]!, { text: "Most founders skip this: reminders.", angle: "b" }, { text: "Day 7 helps.", angle: "c" }] }, { ...post, versions: [post.versions[0]!, { text: "Reminders on day 7 get paid.", angle: "b" }, { text: "Day 7 helps.", angle: "c" }] }]);
  const withReview = await createWriter({ think: reviewed.think, agentFor: () => "x_writer", canFix: true, postSystem: "POST SYSTEM", review: async () => [[], ["Cut the faux-insight setup."], []] }).draft("post", threads, { idea: "Reminders" }, ctx);
  assert.equal(withReview.versions.length, 3);
  assert.match(reviewed.calls[1]!.prompt, /Cut the faux-insight setup/);
  const noFix = scripted([{ ...post, versions: [post.versions[0]!, { text: "Most founders skip this: reminders.", angle: "b" }, { text: "Day 7 helps.", angle: "c" }] }]);
  const kept = await createWriter({ think: noFix.think, agentFor: () => "x_writer", canFix: false, postSystem: "POST SYSTEM", review: async () => [[], ["Cut the faux-insight setup."], []] }).draft("post", threads, { idea: "Reminders" }, ctx);
  assert.deepEqual(kept.versions.map((v) => v.text), ["We send the reminder on day 3.", "Day 7 helps."], "a stock pattern the writer could not fix is dropped (the no-ai-slop gate)");
  // The checker's judgment alone (no pattern the code refuses) never drops a version.
  const judged = scripted([{ ...post, versions: [post.versions[0]!, { text: "Reminders on day 7 get paid.", angle: "b" }, { text: "Day 7 helps.", angle: "c" }] }]);
  const judgedOut = await createWriter({ think: judged.think, agentFor: () => "x_writer", canFix: false, postSystem: "POST SYSTEM", review: async () => [[], ["Too generic."], []] }).draft("post", threads, { idea: "Reminders" }, ctx);
  assert.equal(judgedOut.versions.length, 3, "a review note without a refused pattern still reaches the founder");

  // The CI fakes pass their own checks for every kind, so fake runs and e2e reach a card.
  const fake: WriterThink = async (opts) => opts.schema.parse(opts.fake!());
  const fakeWriter = createWriter({ think: fake, agentFor: () => "x_writer", canFix: false, postSystem: "POST SYSTEM" });
  assert.equal((await fakeWriter.draft("post", threads, { idea: "Why reminders on day 3 and 7 work" }, ctx)).versions.length, 3);
  for (const profile of [captionA, captionB]) assert.ok((await fakeWriter.draft("caption", profile, { video }, ctx)).hashtags.length <= profile.hashtags);
  assert.ok((await fakeWriter.draft("youtube", youtube, { video }, ctx)).title);

  // A kind on the wrong profile is a programming error, not a draft.
  await assert.rejects(createWriter({ think: scripted([]).think, agentFor: () => "x_writer", canFix: false }).draft("caption", threads, { video }, ctx), /caption profile/);
}

// W1: posts per platform profile.
async function postChecks() {
  for (const p of POST_PROFILES) {
    const agent = POST_WRITERS[p.id];
    assert.ok(agent && AGENT_SPECS[agent].tier === "draft", `${p.id} has its own drafting agent`);
  }
  assert.deepEqual([postProfile("threads").id, postProfile("linkedin").id, postProfile("x").id], ["threads", "linkedin", "x"]);
  assert.deepEqual([postProfile("Threads").id, postProfile("LinkedIn").id, postProfile("X").id, postProfile("Twitter").id], ["threads", "linkedin", "x", "x"], "the calendar's labels");
  assert.deepEqual([postProfile(null).id, postProfile("reddit").id, postProfile("youtube").id], ["x", "x", "x"], "no item, an unknown or a video platform: X");
  const linkedin = profile("linkedin");
  const x = profile("x");
  const long = `${"Late invoices are a process problem. ".repeat(11).trim()}`;
  assert.ok([...long].length > 280 && [...long].length <= 500);
  assert.deepEqual(checkPostFor(long, threads, rules), [], "Threads takes 500 characters");
  // D6 (2026-11-12): X takes a long post (X Premium); a free account's refusal is handled at publish time.
  assert.deepEqual(checkPostFor(long, x, rules), [], "X takes a long post");
  assert.ok(checkPostFor("Late invoices. ".repeat(300), x, rules)[0]?.includes("X allows 4000"));
  assert.deepEqual(checkPostFor(`${long}\n\n${long}\n\n${long}`, linkedin, rules), [], "LinkedIn takes 3,000");
  assert.ok(checkPostFor(long.repeat(9), linkedin, rules)[0]?.includes("LinkedIn allows 3000"));
  assert.ok(checkPostFor("Ship it #buildinpublic", linkedin, rules).some((issue) => issue.includes("hashtag")), "no hashtags on any post profile");
  assert.ok(moreAdvice(long, linkedin)[0]?.includes('LinkedIn shows about 140 before "more"'), "a long first line gets advice on LinkedIn");
  assert.deepEqual(moreAdvice(`Late invoices are a process.\n\n${long}`, linkedin), [], "a short first line lands before the cut");
  assert.deepEqual(moreAdvice(long, threads), [], "Threads shows the whole post");


  // A Threads item: its own agent, the <platform> block first, X's prefix. The model is stubbed to read each request.
  process.env.OPENCMO_AGENT_FAKE = "1";
  const docs = { product: { name: "Paylane", pricing: "$12/month" }, brand: { avoid: ["revolutionary"] }, post_plan: { topics: ["The 3-7-14 reminder rule"] } };
  // Wave 3 B3: posts are written from the Library, so every store below starts with a few conversations in it.
  const withLibrary = (m: ReturnType<typeof memoryStore>) => (seedLibrary(m, { ...docs, strategy: { pains: ["late invoices"] } }), m);
  const item = (platform: string, id: string): ItemRow => ({ id, run_id: null, department: "post", platform, day: isoDay(), idea: "Why reminders on day 3, 7 and 14 get invoices paid", reason: "pillar", status: "planned", priority: "medium", body: {}, final_text: null, external_url: null, decided_at: null, published_at: null, created_at: new Date().toISOString() });
  // A 400-character version fits Threads, and X too since X takes long posts (D6).
  const answer = { versions: [{ text: long, angle: "long" }, { text: "Reminders on day 3, 7 and 14.", angle: "short" }], rationale: "r" };
  /** Every request the jobs send, answered with `answer` checked against the job's own schema. */
  const asking = () => {
    const calls: Parameters<JobContext["think"]>[0][] = [];
    const think: JobContext["think"] = async (call) => {
      calls.push(call);
      return call.schema.parse(answer);
    };
    return { calls, think };
  };
  const mem = withLibrary(memoryStore(docs, []));
  mem.items.push(item("threads", "t1"), item("x", "x1"));
  mem.enqueue("post_draft", { item_id: "t1" });
  mem.enqueue("post_draft", { item_id: "x1" });
  const two = asking();
  await drainCmoQueue(mem.store, { think: two.think });
  const [onThreads, onX] = two.calls;
  assert.ok(onThreads && onX, "both runs asked the model");
  assert.deepEqual([onThreads.agent, onX.agent], ["threads_writer", "x_writer"]);
  assert.equal(onThreads.system, onX.system, "one cached prefix for every post profile");
  assert.deepEqual([profileFromPrompt(onThreads.prompt), profileFromPrompt(onX.prompt)], ["threads", "x"]);
  assert.match(onThreads.title, /today's Threads post/);
  const threadsCard = mem.items.find((i) => i.id === "t1")!;
  const xCard = mem.items.find((i) => i.id === "x1")!;
  assert.equal(threadsCard.status, "in_review");
  assert.deepEqual([threadsCard.body.text, threadsCard.body.alternates], [long, ["Reminders on day 3, 7 and 14."]]);
  assert.deepEqual([xCard.body.text, xCard.body.alternates], [long, ["Reminders on day 3, 7 and 14."]], "X keeps the long version");

  // A slot for two platforms is one core post (D3): the core profile, and the draft keeps the planner's targets.
  const core = withLibrary(memoryStore(docs, []));
  core.items.push({ ...item("X", "c1"), body: { targets: ["x", "linkedin"], slot: 0 } });
  core.enqueue("post_draft", { item_id: "c1" });
  const coreAsk = asking();
  await drainCmoQueue(core.store, { think: coreAsk.think });
  assert.equal(profileFromPrompt(coreAsk.calls[0]!.prompt), "core", "two targets: the core profile");
  const coreCard = core.items.find((i) => i.id === "c1")!;
  assert.deepEqual([coreCard.status, coreCard.body.targets, coreCard.body.slot], ["in_review", ["x", "linkedin"], 0], "the draft keeps its targets");

  // W2: the founder's rules first, then their voice notes (newest, weightiest), then documents; the prefix is the same
  // whatever the founder's notes say; voice notes are not read twice through the general memories.
  const voiced = withLibrary(memoryStore(docs, ["Skipped a draft: too salesy"], [], ["Never end with a summary line."]));
  voiced.voice.push(
    { body: 'Edited on LinkedIn before approving (cut it shorter): "Reminders get paid."', platform: "linkedin", created_at: "2026-10-28T09:00:00Z", weight: 0.98 },
    { body: 'Approved as written on X: "Day 3, 7, 14."', platform: "x", created_at: "2026-09-10T09:00:00Z", weight: 0.2 },
  );
  voiced.items.push(item("LinkedIn", "lv"));
  voiced.enqueue("post_draft", { item_id: "lv" });
  const voicedAsk = asking();
  await drainCmoQueue(voiced.store, { think: voicedAsk.think });
  const asked = voicedAsk.calls[0]!;
  assert.equal(profileFromPrompt(asked.prompt), "linkedin", "a calendar label resolves to its profile");
  assert.equal(asked.agent, "linkedin_writer");
  const at = (tag: string) => asked.prompt.indexOf(tag);
  assert.ok(at("<platform>") === 0 && at("<platform>") < at("<founder_rules") && at("<founder_rules") < at("<founder_voice") && at("<founder_voice") < at("<documents>") && at("<documents>") < at("<memories>"), "rules, then voice, then documents and memories");
  assert.ok(asked.prompt.indexOf("cut it shorter") < asked.prompt.indexOf("Day 3, 7, 14."), "the newer, heavier note first");
  assert.match(asked.prompt, /\(LinkedIn, weight 0\.98, 2026-10-28\)/);
  assert.equal(asked.system, onX.system, "the founder's notes never change the cached prefix");
  assert.match(asked.system, /When their voice and the no-ai-slop guidance disagree, write it their way/);

  // The fake writer drafts LinkedIn too, end to end.
  const fake = withLibrary(memoryStore(docs, []));
  fake.items.push(item("linkedin", "l1"));
  const run = fake.enqueue("post_draft", { item_id: "l1" });
  await drainCmoQueue(fake.store);
  assert.equal(run.status, "done", `LinkedIn draft (${run.error})`);
  assert.equal(fake.items.find((i) => i.id === "l1")!.status, "in_review");
  delete process.env.OPENCMO_AGENT_FAKE;
}

// W3: Writer's runs for Studio, through the runner on the fake provider.
async function studioChecks() {
  for (const p of CAPTION_PROFILES) assert.ok(CAPTION_WRITERS[p.id] && AGENT_SPECS[CAPTION_WRITERS[p.id]!].tier === "draft", `${p.id} has its own writer agent`);
  assert.deepEqual([writerAgent("youtube", youtube), writerAgent("post", threads)], ["youtube_writer", "threads_writer"]);

  assert.deepEqual([firstLine("Your invoice is late. Paylane sends it."), firstLine("no stop at all"), firstLine("v1.2 shipped today! More soon.")], ["Your invoice is late.", "no stop at all", "v1.2 shipped today!"], "the first sentence said, not a decimal point");
  process.env.OPENCMO_AGENT_FAKE = "1";
  const docs = { product: { name: "Paylane", pricing: "$12/month" }, brand: { avoid: ["revolutionary"] } };

  // write_caption: each edit × each profile, saved through the store with the published text.
  const cap = memoryStore(docs, []);
  cap.videos.push(
    { clipId: "s1", kind: "short", title: "Late invoices", hook: "Your invoice is 14 days late.", transcript: "Your invoice is 14 days late. Paylane sends the reminder.", seconds: 31 },
    { clipId: "s2", kind: "short", title: "The day 3 reminder", hook: "Day 3 is the first nudge.", transcript: "Day 3 is the first nudge. Then day 7.", seconds: 24 },
  );
  cap.captions.push({ runId: "earlier", clipId: "s2", profile: "youtube", text: "The founder's own words", title: null, gen: {}, edited: true });
  const c = cap.enqueue("write_caption", { order_id: "o3", clip_ids: ["s1", "s2", "s1"], profiles: ["youtube", "x", "made_up"], ref_kind: "short_batch", ref_id: "b1" });
  await drainCmoQueue(cap.store);
  assert.equal(c.status, "done", `caption run (${c.error})`);
  assert.equal((c.output as { saved: number }).saved, 2, "two edits on YouTube; X and unknown ids ignored, a repeated edit once");
  assert.equal(cap.captions.find((row) => row.clipId === "s2" && row.profile === "youtube")!.text, "The founder's own words", "a caption the founder edited is never overwritten");
  for (const row of cap.captions.filter((r) => r.runId === c.id)) {
    const p = profile(row.profile);
    assert.ok([...row.text].length <= p.limit && countHashtags(row.text) <= p.hashtags && !/https?:\/\/|www\./i.test(row.text), `${row.profile} passes cmo_save_caption's rules`);
    assert.equal(row.title === null, p.kind !== "youtube", "a title only on YouTube");
    assert.ok(row.title === null || [...row.title].length <= (p.title ?? 100));
    assert.deepEqual(Object.keys(row.gen).sort(), ["model", "prompt_version"]);
  }
  assert.deepEqual(new Set(c.steps.map((step) => step.tool)).has("write_caption_youtube_1"), true, "one step per edit and profile");

  const gone = memoryStore(docs, []);
  gone.videos.push({ clipId: "s1", kind: "video", title: "Demo", transcript: "Paylane sends the reminder.", seconds: 40 });
  const partial = gone.enqueue("write_caption", { order_id: "o4", clip_ids: ["s1", "missing"], profiles: ["youtube"] });
  await drainCmoQueue(gone.store);
  assert.equal(partial.status, "done");
  assert.deepEqual([(partial.output as { saved: number }).saved, (partial.output as { failed: string[] }).failed.length], [1, 1], "a missing edit is reported, the others still get captions");
  const nothing = gone.enqueue("write_caption", { order_id: "o5", clip_ids: ["missing"], profiles: ["youtube"] });
  const empty = gone.enqueue("write_caption", { order_id: "o6", clip_ids: [], profiles: ["youtube"] });
  await drainCmoQueue(gone.store);
  assert.deepEqual([nothing.status, empty.status], ["failed", "failed"], "no caption saved fails the run (its credit is refunded)");

  // F2 (2026-11-13): Writer no longer writes slideshows; SQL refuses the kind (`cmo_job_daily_limit` is 0).
  assert.ok(!(CMO_JOB_KINDS as readonly string[]).includes("write_slides"), "no write_slides job");
  assert.ok(!(WRITER_KINDS as readonly string[]).includes("slides"), "no slides kind in Writer");
  delete process.env.OPENCMO_AGENT_FAKE;
}

writerChecks().then(postChecks).then(studioChecks).then(
  () => console.log("writer.check: ok"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
