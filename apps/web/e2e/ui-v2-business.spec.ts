import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";

/**
 * Your business (wave 3, C3): the five documents on one page, Strategy's where they ask and this week, the Brand's voice
 * samples and look, a sample pasted and saved as a new version, and "Read my website again" asking before it writes over
 * the founder's edits. Screenshots: `test-results/business-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function founderWithDocuments() {
  const db = admin();
  const email = `e2e-business-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  const docs = [
    { kind: "product", created_by: "agent", body: { name: "Dunly", category: "SaaS", one_liner: "Sends the invoice reminders for you.", description: "", audience: "Freelancers", problems: ["Clients pay late"], features: ["Reminder schedules"], pricing: "$12/month" } },
    { kind: "strategy", created_by: "user", body: { icp: "A freelancer with 5 to 30 clients", pains: ["Chasing the same client for weeks"], where_they_ask: ["r/freelance", "Ask HN"], positioning: "The reminder tool that runs on its own.", value_props: [], this_week: "Reply to people asking about late payment." } },
    { kind: "competitors", created_by: "agent", body: { competitors: [{ name: "Bonsai", website: "https://hellobonsai.com", difference: "A full suite; reminders are one feature." }] } },
    { kind: "post_plan", created_by: "agent", body: { topics: ["Chasing late invoices"], channels: ["x", "linkedin"], rhythm: "Three posts a week." } },
    { kind: "brand", created_by: "agent", body: { voice: "Plain and short.", voice_samples: [], intro_line: "I built Dunly.", avoid: ["seamless"], look: { logo_url: "https://dunly.test/logo.svg", colors: ["#2F3C9E", "#E0662D"], font: "Inter", screenshots: [], image_styles: ["Screenshot + one line"] } } },
  ];
  const { error } = await db.from("marketing_documents").insert(docs.map((d) => ({ user_id: userId, version: 1, ...d })));
  if (error) throw new Error(`could not seed the documents: ${error.message}`);
  // The site the documents were drafted from: "Read my website again" reads it.
  await db.from("cmo_runs").insert({ user_id: userId, kind: "onboard", status: "done", input: { site: "dunly.test" } });
  return { email, password, id: userId };
}

test("Your business: five documents, Brand voice and look, a pasted sample, and Read my website again asks first", async ({ page }) => {
  test.setTimeout(120_000);
  const user = await founderWithDocuments();
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The Context column's card opens the page.
  await page.goto("/app");
  await page.getByRole("complementary", { name: "Context" }).getByTestId("context-documents").click();
  await expect(page).toHaveURL(/\/app\/business$/);
  const nav = page.getByRole("navigation", { name: "Documents" });
  await expect(nav.getByTestId("business-doc")).toHaveText([/^Product/, /^Strategy/, /^Competitors/, /^Post plan/, /^Brand/]);
  await expect(page.getByRole("heading", { level: 1, name: "Product" })).toBeVisible();

  await nav.getByRole("button", { name: /^Strategy/ }).click();
  await expect(page).toHaveURL(/\/app\/business\?d=strategy$/);
  const fields = page.getByTestId("business-fields");
  await expect(fields).toContainText("Where they ask");
  await expect(fields).toContainText("r/freelance");
  await expect(fields).toContainText("Reply to people asking about late payment.");

  await nav.getByRole("button", { name: /^Brand/ }).click();
  await expect(fields).toContainText("Voice · your writing samples");
  await expect(page.getByTestId("brand-colors")).toContainText("#2F3C9E");
  await expect(page.getByTestId("brand-preview")).toContainText("Dunly");
  await page.screenshot({ path: "test-results/business-brand-1440.png", fullPage: true });

  // Paste a sample: one box per sample, saved as a new version.
  await page.getByTestId("v2-business").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByTestId("brand-samples").getByLabel("Sample 1").fill("Put the date on the invoice, not in the email.\nClients read invoices.");
  await page.getByTestId("v2-business").getByRole("button", { name: "Save", exact: true }).click();
  await expect(fields).toContainText("Put the date on the invoice, not in the email.");
  const { data: brand } = await admin().from("marketing_documents_latest").select("version, created_by, body").eq("user_id", user.id).eq("kind", "brand").single();
  expect(brand!.version).toBe(2);
  expect(brand!.created_by).toBe("user");
  expect((brand!.body as { voice_samples: string[] }).voice_samples).toEqual(["Put the date on the invoice, not in the email.\nClients read invoices."]);

  // Reading the site again names the documents the founder edited and waits for a yes.
  await nav.getByRole("button", { name: "Read my website again" }).click();
  const confirm = page.getByTestId("business-reread-confirm");
  await expect(confirm).toContainText("You edited Strategy and Brand.");
  await confirm.getByRole("button", { name: "Keep my edits" }).click();
  await expect(confirm).toHaveCount(0);
  const { count } = await admin().from("cmo_runs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "onboard");
  expect(count).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/business?d=brand");
  await expect(page.getByRole("heading", { level: 1, name: "Brand" })).toBeVisible();
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/business-brand-390.png", fullPage: true });
});
