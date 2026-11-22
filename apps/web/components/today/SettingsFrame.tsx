"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

/** The Settings menu (Settings.dc.html). Billing has its own route (server data); the rest are parts of one page. */
const NAV = [
  { id: "account", label: "Account", href: "/app/settings#settings-account" },
  { id: "general", label: "Planning", href: "/app/settings#settings-your-cmo" },
  { id: "accounts", label: "Accounts", href: "/app/settings#settings-connected-accounts" },
  { id: "sales", label: "Sales scans", href: "/app/settings#settings-sales-scans" },
  { id: "tracking", label: "Tracking", href: "/app/settings#settings-tracking" },
  { id: "notifications", label: "Notifications", href: "/app/settings#settings-notify" },
  { id: "brand", label: "Brand", href: "/app/business?d=brand" },
  { id: "billing", label: "Billing", href: "/app/billing" },
  { id: "keys", label: "API keys", href: "/app/settings#api-keys" },
] as const satisfies readonly { id: string; label: string; href: string }[];
export type SettingsSection = (typeof NAV)[number]["id"];

/** The part of /app/settings a `#hash` opens, so the menu marks the one the founder picked (E2E 2026-11-22). */
function sectionOf(hash: string): SettingsSection | null {
  const found = NAV.find((n) => n.href.startsWith("/app/settings#") && n.href.endsWith(hash));
  return hash && found ? found.id : null;
}

/** `keys`: the API keys entry, shown only where the editor (all the MCP server's tools) is reachable. */
export function SettingsFrame({ current, keys = false, children }: { current: SettingsSection; keys?: boolean; children: ReactNode }) {
  const router = useRouter();
  const [hashed, setHashed] = useState<SettingsSection | null>(null);
  const onSettings = current !== "billing";
  useEffect(() => {
    if (!onSettings) return;
    const read = () => setHashed(sectionOf(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [onSettings]);
  const marked = (onSettings && hashed) || current;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", maxWidth: "1200px", margin: "0 auto" }}>
      <nav className="nav" aria-label="Settings">
        {NAV.filter((n) => keys || n.id !== "keys").map((n) => (
          <button key={n.id} type="button" aria-current={n.id === marked ? "page" : undefined} onClick={() => {
              // A push to another #part of the same page fires no hashchange.
              if (onSettings && n.href.startsWith("/app/settings#")) setHashed(n.id);
              router.push(n.href);
            }}>
            {n.label}
          </button>
        ))}
      </nav>
      <main style={{ flex: "999 1 600px", minWidth: "0", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: "16px", maxWidth: "860px" }}>{children}</main>
    </div>
  );
}
