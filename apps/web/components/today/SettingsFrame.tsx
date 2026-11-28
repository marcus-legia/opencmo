"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

/**
 * The Settings menu (Settings.dc.html). Billing has its own route (server data); the rest are parts of one page, listed
 * in the order the page draws them (`SettingsScreen`): the menu said Account, Planning, Accounts… over a page that
 * starts with Connected accounts (production 28/11). Brand and Billing open other pages, so they come last.
 */
const NAV = [
  { id: "accounts", label: "Connected accounts", href: "/app/settings#settings-connected-accounts" },
  { id: "sales", label: "Sales scans", href: "/app/settings#settings-sales-scans" },
  { id: "tracking", label: "Tracking", href: "/app/settings#settings-tracking" },
  { id: "general", label: "Planning", href: "/app/settings#settings-your-cmo" },
  { id: "notifications", label: "Notifications", href: "/app/settings#settings-notify" },
  { id: "account", label: "Account", href: "/app/settings#settings-account" },
  { id: "keys", label: "API keys", href: "/app/settings#api-keys" },
  { id: "brand", label: "Brand", href: "/app/business?d=brand" },
  { id: "billing", label: "Billing", href: "/app/billing" },
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
  // On a phone the menu is one row that scrolls sideways: keep the marked entry in view (Billing sat off-screen).
  useEffect(() => {
    document.querySelector<HTMLElement>('nav[aria-label="Settings"] [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [marked]);
  return (
    <div className="uip-settings">
      <nav className="nav uip-settings__nav" aria-label="Settings">
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
      <main className="uip-settings__main">{children}</main>
    </div>
  );
}
