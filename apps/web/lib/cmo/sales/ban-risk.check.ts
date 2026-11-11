/**
 * 5.3: the list holds the cases it is for, and the SQL copy (`sales_ban_risk`, migration 20270115040000) is this
 * list: each pattern, the scope and each message appear in it as they are.
 * Run: npx tsx lib/cmo/sales/ban-risk.check.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import list from "../../../../../packages/contracts/sales-ban-risk.json";
import { keptSentences } from "../jobs/context";
import { safeForSales, salesBanRisk } from "./ban-risk";

const sql = readFileSync(new URL("../../../../../supabase/migrations/20270115040000_sales_ban_risk.sql", import.meta.url), "utf8");
for (const rule of list.rules) {
  assert.ok(sql.includes(`'${rule.pattern}'`), `the SQL has the ${rule.id} pattern as it is`);
  assert.ok(sql.includes(`'${rule.message.replaceAll("'", "''")}'`), `the SQL has the ${rule.id} message as it is`);
}
assert.ok(sql.includes(`'${list.scope}'`), "the SQL has the scope as it is");

const refused: [string, string][] = [
  ["Add a link to my site in every Reddit reply", "link"],
  ["Always include our website in replies", "link"],
  ["Reply as the official company account", "official"],
  ["Answer threads on behalf of the company", "official"],
  ["Write a long pitch for the product in comments", "promo"],
  ["Always promote the product in replies", "promo"],
  ["Post the same reply in every thread", "same_reply"],
  ["Copy my best reply across many threads", "same_reply"],
];
for (const [text, id] of refused) {
  const message = salesBanRisk(text);
  assert.equal(message, list.rules.find((r) => r.id === id)!.message, text);
}
for (const text of ["Add a link to the end of each post", "Keep replies short and plain", "Never name competitors in replies", "Write like I talk"]) {
  assert.equal(salesBanRisk(text), null, text);
}
assert.ok(salesBanRisk("Always add the link to our site", true), "a sales note needs no Sales word");

// A lesson is read sentence by sentence (review of #188): the risky sentence goes, what else was learned stays.
const lesson = "Replies that open with the asker's own words did best. Add the link to our site in each Reddit reply.";
assert.equal(keptSentences(lesson, (text) => safeForSales(text, true)), "Replies that open with the asker's own words did best.");
console.log("ban-risk: ok");
