import { expect, test, type Page } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * Connecting apps to OpenCMO (security fixes plan, fixes 5 and 6): only paid accounts may
 * connect. A real authorization comes from local Supabase's OAuth server, registered the way
 * claude.ai registers itself (dynamic client registration).
 */

/** Registers a client for `redirect` and starts an authorization; returns its id. */
async function authorizationFor(page: Page, redirect: string): Promise<string> {
  const { url, anon } = state();
  const registered = await page.request.post(`${url}/auth/v1/oauth/clients/register`, {
    headers: { apikey: anon, "content-type": "application/json" },
    data: { client_name: "E2E client", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] },
  });
  expect(registered.ok()).toBeTruthy();
  const { client_id } = (await registered.json()) as { client_id: string };
  const query = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirect,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "e2e",
  });
  const started = await page.request.get(`${url}/auth/v1/oauth/authorize?${query}`, { maxRedirects: 0 });
  const id = new URL(started.headers().location ?? "", "http://x").searchParams.get("authorization_id");
  expect(id).toBeTruthy();
  return id!;
}

const decide = (page: Page, id: string, decision: "approve" | "deny") =>
  page.request.post("/api/v1/oauth/consent", { data: { authorization_id: id, decision } });

test("free account: Settings shows the paid-plan path instead of API keys", async ({ page }) => {
  await signIn(page, state().users.b);
  await page.goto("/app/settings");
  const keys = page.getByTestId("api-keys");
  await expect(keys.getByTestId("mcp-paid-plan")).toContainText("Connect Claude with a paid plan");
  await expect(keys.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/billing");
  await expect(page.getByTestId("api-key-create")).toHaveCount(0);
  await expect(page.getByTestId("connected-apps").getByTestId("mcp-paid-plan")).toBeVisible();
});

test("free account: the consent screen offers Deny only, and approve is refused", async ({ page }) => {
  await signIn(page, state().users.b);
  const id = await authorizationFor(page, "http://localhost:9/callback");
  await page.goto(`/oauth/consent?authorization_id=${id}`);
  await expect(page.getByTestId("oauth-consent")).toContainText("part of the paid plans");
  await expect(page.getByTestId("oauth-approve")).toHaveCount(0);
  await expect(page.getByTestId("oauth-deny")).toBeVisible();

  const refused = await decide(page, id, "approve");
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toContain("part of the paid plans");
});
