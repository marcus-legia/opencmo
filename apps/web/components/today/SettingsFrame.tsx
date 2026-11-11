"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** The Settings menu (Settings.dc.html). Billing has its own route (server data); the rest are parts of one page. */
const NAV = [
  { id: "general", label: "General", href: "/app/settings#settings-your-cmo" },
  { id: "accounts", label: "Accounts", href: "/app/settings#settings-connected-accounts" },
  { id: "notifications", label: "Notifications", href: "/app/settings#settings-notify" },
  { id: "brand", label: "Brand Kit", href: "/app?doc=brand" },
  { id: "billing", label: "Billing", href: "/app/billing" },
  { id: "keys", label: "API keys", href: "/app/settings#api-keys" },
] as const;
export type SettingsSection = (typeof NAV)[number]["id"];

export function SettingsFrame({ current, children }: { current: SettingsSection; children: ReactNode }) {
  const router = useRouter();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", maxWidth: "1200px", margin: "0 auto" }}>
      <nav className="nav" aria-label="Settings">
        {NAV.map((n) => (
          <button key={n.id} type="button" aria-current={n.id === current ? "page" : undefined} onClick={() => router.push(n.href)}>
            {n.label}
          </button>
        ))}
      </nav>
      <main style={{ flex: "999 1 600px", minWidth: "0", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: "16px", maxWidth: "860px" }}>{children}</main>
    </div>
  );
}
