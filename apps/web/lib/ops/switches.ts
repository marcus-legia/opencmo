/**
 * The CMO's live switches, read from env, for the owner's Costs page (cmo-review plan B1.6).
 *
 * Every outbound channel is off unless an owner gate is set, and an unset key fails silently: no email, no push, no
 * posting, the brain still running. This list makes that visible. Where a module already decides "live or not", this
 * asks the module instead of re-reading the variable, so the page cannot drift from what the code does.
 */

import { publishAnalytics } from "@/lib/departments/publish/analytics";
import { emailSender } from "@/lib/notify/email";
import { vapidFromEnv } from "@/lib/notify/push";

export type Switch = {
  id: string;
  label: string;
  on: boolean;
  /** What to set when it is off; what it means when it is on. Never a secret value. */
  detail: string;
};

type Env = Record<string, string | undefined>;

const set = (env: Env, name: string) => Boolean(env[name]?.trim());

export function cmoSwitches(env: Env = process.env): Switch[] {
  const email = emailSender(env);
  const zernio = publishAnalytics(env);
  const push = vapidFromEnv(env) !== null;
  return [
    {
      id: "ui_v2",
      label: "App UI v2 (inbox, schedule, accounts, analytics)",
      on: env.NEXT_PUBLIC_OPENCMO_UI === "v2",
      detail: env.NEXT_PUBLIC_OPENCMO_UI === "v2" ? "On." : "Set NEXT_PUBLIC_OPENCMO_UI=v2 and redeploy (it is inlined at build time).",
    },
    {
      id: "email",
      label: "Email (digest, expiring cards)",
      on: email?.name === "resend",
      detail:
        email?.name === "resend"
          ? `Sends from ${env.OPENCMO_EMAIL_FROM?.trim() || "the default sender"}.`
          : "Set RESEND_API_KEY and OPENCMO_EMAIL_LIVE=1 (sender on a verified domain in OPENCMO_EMAIL_FROM).",
    },
    {
      id: "push",
      label: "Web push",
      on: push,
      detail: push ? "On." : "Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys).",
    },
    {
      id: "publish",
      label: "Posting and metrics through Zernio",
      on: zernio?.name === "zernio",
      detail:
        zernio?.name === "zernio"
          ? "Live: approved schedule cards post at their time."
          : zernio
            ? "The fake adapter is on (OPENCMO_PUBLISH_FAKE=1). Nothing real is posted."
            : "Set ZERNIO_API_KEY and OPENCMO_PUBLISH_LIVE=1 after the Zernio checks. Until then cards offer copy and open.",
    },
    {
      id: "zernio_webhook",
      label: "Zernio webhook secret",
      on: set(env, "ZERNIO_WEBHOOK_SECRET"),
      detail: set(env, "ZERNIO_WEBHOOK_SECRET") ? "On." : "Set ZERNIO_WEBHOOK_SECRET and point Zernio's webhook at /api/webhooks/zernio.",
    },
    {
      id: "social_reader",
      label: "Reading X, TikTok, YouTube and Reddit (research, Sales)",
      on: set(env, "SCRAPECREATORS_API_KEY") || set(env, "SCRAPE_CREATORS_API_KEY"),
      detail: set(env, "SCRAPECREATORS_API_KEY") || set(env, "SCRAPE_CREATORS_API_KEY") ? "On." : "Set SCRAPECREATORS_API_KEY.",
    },
    {
      id: "cron",
      label: "Clock calls from Modal (sweep, plan, digest)",
      on: set(env, "CRON_SECRET"),
      detail: set(env, "CRON_SECRET")
        ? "The web side accepts the clock. Modal needs the same CRON_SECRET and OPENCMO_WEB_URL in its secret."
        : "Set CRON_SECRET here and in the Modal secret; without it every cron route refuses.",
    },
    {
      id: "mcp",
      label: "Connect Claude (MCP)",
      on: set(env, "OPENCMO_MCP_URL") && set(env, "OPENCMO_MCP_CONFIRM_KEY"),
      detail: set(env, "OPENCMO_MCP_URL") && set(env, "OPENCMO_MCP_CONFIRM_KEY") ? "On." : "Set OPENCMO_MCP_URL and OPENCMO_MCP_CONFIRM_KEY.",
    },
    {
      id: "paused",
      label: "Brain running (global kill switch off)",
      on: env.OPENCMO_CMO_PAUSED !== "1",
      detail: env.OPENCMO_CMO_PAUSED === "1" ? "OPENCMO_CMO_PAUSED=1: every founder's brain is paused." : "Running.",
    },
  ];
}
