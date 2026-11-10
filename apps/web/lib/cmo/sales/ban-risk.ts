import list from "../../../../../packages/contracts/sales-ban-risk.json";

/**
 * Founder rules that would get a Reddit account banned (groups 4-5 plan, 5.3): a link in replies, an official or
 * company account, long or constant promotion, the same reply in many threads. One list
 * (`packages/contracts/sales-ban-risk.json`) for this check, the zod at the routes and the SQL triggers
 * (`sales_ban_risk`), so the founder reads the same sentence wherever the rule is written.
 *
 * A rule is risky only when it is about Sales: a memory with topic `sales`, or words like replies, Reddit or threads.
 * "Add a link to the end of each post" is a Writer rule and is not touched.
 */
const SCOPE = new RegExp(list.scope, "i");
const RULES = list.rules.map((rule) => ({ id: rule.id, pattern: new RegExp(rule.pattern, "i"), message: rule.message }));

/** The plain message for a risky rule, or null. */
export function salesBanRisk(text: string, sales = false): string | null {
  if (!text || !(sales || SCOPE.test(text))) return null;
  return RULES.find((rule) => rule.pattern.test(text))?.message ?? null;
}

/** For Sales prompts: a rule written before 5.3, or by a job, that would get the account banned is left out. */
export const safeForSales = (text: string) => salesBanRisk(text) === null;
