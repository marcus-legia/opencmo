import list from "../../../../../packages/contracts/sales-ban-risk.json";

/**
 * Founder rules that would get a Reddit account banned (groups 4-5 plan, 5.3): a link in replies, an official or
 * company account, long or constant promotion, the same reply in many threads. One list
 * (`packages/contracts/sales-ban-risk.json`) for this check, the zod at the routes and the SQL triggers
 * (`sales_ban_risk`), so the founder reads the same sentence wherever the rule is written.
 *
 * A rule is risky only when it is about Sales: a memory with topic `sales`, or words like replies or Reddit. "Add a
 * link to the end of each post" or "…of each thread" (an X thread) is a Writer rule and is not touched. A clause that
 * forbids the thing ("never add links in replies") is the safe rule, so it is taken out before the patterns run.
 */
const SCOPE = new RegExp(list.scope, "i");
const NEGATED = new RegExp(list.negated, "gi");
const RULES = list.rules.map((rule) => ({ id: rule.id, pattern: new RegExp(rule.pattern, "i"), message: rule.message }));

/** The plain message for a risky rule, or null. */
export function salesBanRisk(text: string, sales = false): string | null {
  if (!text || !(sales || SCOPE.test(text))) return null;
  const asked = text.replace(NEGATED, "");
  return RULES.find((rule) => rule.pattern.test(asked))?.message ?? null;
}

/** For Sales prompts: a rule written before 5.3, or by a job, that would get the account banned is left out. */
/** True when `text` may reach the Sales reply prompt; `sales`: the text is about Sales already (a sales note, a Sales lesson). */
export const safeForSales = (text: string, sales = false) => salesBanRisk(text, sales) === null;
