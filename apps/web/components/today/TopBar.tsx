"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { prefetchScreen, useScreen } from "@/components/screens/useScreen";
import { useOptionalShellState } from "@/components/shell-v2/ShellState";
import type { ScreenName } from "@/lib/screens/registry";
import type { Autopilot } from "@/lib/screens/settings";

import { publishAutopilot, useAutopilotChanges } from "./autopilot";

import { siteLabel, useWorkspace } from "./workspace";

/** What each view reads: hovering or focusing its link reads it ahead, so the click lands on data, not "Loading…". */
const VIEW_SCREENS: Record<string, ScreenName[]> = {
  feed: ["schedule"],
  calendar: ["schedule", "dashboard"],
  sales: ["sales"],
  analytics: ["analytics", "dashboard", "research", "sales"],
};
const readAhead = (view: string) => () => VIEW_SCREENS[view]?.forEach((name) => prefetchScreen(name));

const AUTOPILOT_LABEL: Record<Autopilot["platforms"][number], string> = { x: "X", threads: "Threads", linkedin: "LinkedIn" };

const BoltIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </svg>
);

/**
 * Autopilot's switch (owner, 2026-11-13), on every view: on, posts on the chosen platforms go out at their time unless
 * the founder changes them; off, every post waits for Approve and the platforms are kept for the way back. Hidden for a
 * founder who never chose a platform, so the bar is unchanged for them.
 */
function AutopilotSwitch() {
  const [screen, reload] = useScreen("settings");
  const shell = useOptionalShellState();
  const [changed, setChanged] = useState<Autopilot | null>(null);
  const [busy, setBusy] = useState(false);
  useAutopilotChanges(useCallback((value: Autopilot) => setChanged(value), []));
  const ready = screen.status === "ready" ? screen : null;
  const value = changed ?? ready?.data.autopilot ?? null;
  if (!value || value.platforms.length === 0) return null;
  const on = !value.paused;
  const names = value.platforms.map((id) => AUTOPILOT_LABEL[id]).join(", ");

  async function flip() {
    if (!value) return;
    setBusy(true);
    try {
      // Sample settings change only on this page, like the Settings block.
      const next = ready?.live.autopilot
        ? await api<Autopilot>("/cmo/autopilot", jsonBody({ paused: on }, "PATCH"))
        : { ...value, paused: on };
      setChanged(next);
      publishAutopilot(next);
      reload();
      shell?.workChanged();
      shell?.toast(next.paused ? "Autopilot is off. Every post waits for your Approve." : `Autopilot is on for ${names}.`);
    } catch (err) {
      shell?.toast(err instanceof ApiError ? err.message : "Could not change autopilot. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={on ? "pill td-autopilot" : "pill td-autopilot is-off"}
      aria-pressed={on}
      disabled={busy}
      title={on ? `Autopilot is on for ${names}. Press to turn it off: every post waits for your Approve.` : `Autopilot is off. Press to turn it back on for ${names}.`}
      onClick={() => void flip()}
      data-testid="autopilot-switch"
    >
      <BoltIcon />
      <span className="td-pill-label">{on ? "Autopilot on" : "Autopilot off"}</span>
      {on ? <span className="live" aria-hidden="true"></span> : null}
    </button>
  );
}

/**
 * The top bars of the Today canvas (docs/design/today-canvas). Each artboard has its own: `home` (Main), `views`
 * (Calendar, Analytics), `crumbs` (agent pages, Settings, Projects) and `logs`. Markup and inline styles are the
 * artboards' own; the classes come from `styles/today.css` under the screen's `pg-*` scope.
 */
export type TopVariant =
  | { kind: "home" }
  | { kind: "views"; current: "feed" | "calendar" | "photos" | "sales" | "analytics" | null }
  | { kind: "crumbs"; trail: { label: string; href?: string }[]; logs?: boolean; chat?: boolean; credits?: boolean; back?: boolean };

const Chevron = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChatIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const LogsIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </svg>
);

/** The business switcher: the product's initial and name, a menu with what has no other place in the frame. */
const CoinIcon = () => (
  <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H10a2 2 0 0 0 0 4h5" />
  </svg>
);

function Project({ menu }: { menu: ReactNode }) {
  const ws = useWorkspace();
  const name = ws.name ?? siteLabel(ws.site) ?? "Your business";
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="td-menuwrap" ref={ref} onClick={(e) => (e.target as HTMLElement).closest("a") && ref.current?.removeAttribute("open")}>
      <summary className="pill" style={{ color: "var(--text)", gap: "8px", border: "0", padding: "0 8px", listStyle: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", borderRadius: "5px", background: "var(--accent)", color: "var(--accent-ink)", fontWeight: "700", fontSize: "12px" }}>
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="td-project-name" style={{ fontWeight: "600" }}>{name}</span>
        <Chevron />
      </summary>
      <div className="td-menu">{menu}</div>
    </details>
  );
}

function Avatar({ email }: { email: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="td-menuwrap is-right" ref={ref} onClick={(e) => (e.target as HTMLElement).closest("a") && ref.current?.removeAttribute("open")}>
      <summary
        aria-label="Account"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", borderRadius: "50%", background: "var(--line-2)", fontSize: "13px", fontWeight: "600", listStyle: "none", cursor: "pointer" }}
      >
        {(email ?? "?").charAt(0).toUpperCase()}
      </summary>
      <div className="td-menu">
        <span className="td-menu-note">{email ?? "Signed in"}</span>
        <Link href="/app/settings">Settings</Link>
        <Link href="/app/billing">Billing</Link>
        <form action="/auth/signout" method="post">
          <button type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}

/** Pages the canvas reaches from the business menu rather than from a rail. */
const MORE = (
  <>
    <Link href="/app?doc=product">Documents and Brand Kit</Link>
    <Link href="/app/research">Research</Link>
    <Link href="/app?doc=plan">Plan and orders</Link>
    <Link href="/app?doc=voice">Voice and skills</Link>
    <Link href="/app/studio">Projects</Link>
    <Link href="/app/settings">Settings</Link>
  </>
);

export function TopBar({
  variant,
  credits,
  email,
  logsOpen,
  onLogs,
  onChat,
}: {
  variant: TopVariant;
  credits: number | null;
  email: string | null;
  logsOpen: boolean;
  onLogs: () => void;
  onChat: () => void;
}) {
  const ws = useWorkspace();
  const x = ws.accounts.find((a) => a.platform === "x");
  const linkedin = ws.accounts.some((a) => a.platform === "linkedin");
  // On a phone the word goes (the coin and the number stay; the link keeps "credits" for screen readers).
  const creditsLabel = (
    <span>
      {credits ?? "–"}
      <span className="td-pill-more"> credits</span>
    </span>
  );

  // Feed, Calendar and Analytics share one bar (owner, 2026-11-10): the business and its accounts on the left, the three
  // views in the middle as links (prefetched, so a switch is instant), credits, Logs and the chat on the right. On the
  // feed the chat is a column, so its button is not needed there.
  if (variant.kind === "home" || variant.kind === "views") {
    const current = variant.kind === "home" ? "feed" : variant.current;
    const views = [
      {
        id: "feed",
        label: "Feed",
        href: "/app",
        icon: (
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        ),
      },
      {
        id: "calendar",
        label: "Calendar",
        href: "/app/schedule",
        icon: (
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="18" height="18" x="3" y="4" rx="2" />
            <path d="M16 2v4" />
            <path d="M8 2v4" />
            <path d="M3 10h18" />
          </svg>
        ),
      },
      {
        id: "photos",
        label: "Photos",
        href: "/app/photos",
        icon: (
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
          </svg>
        ),
      },
      {
        id: "sales",
        label: "Sales",
        href: "/app/sales",
        icon: (
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
        ),
      },
      {
        id: "analytics",
        label: "Analytics",
        href: "/app/analytics",
        icon: (
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3v16a2 2 0 0 0 2 2h16" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
        ),
      },
    ] as const;
    return (
      <header className="top td-viewsbar">
        <Project menu={MORE} />
        <span style={{ width: "1px", height: "18px", background: "var(--line-2)", margin: "0 4px" }}></span>
        {x ? (
          <span className="pill" style={{ cursor: "default" }}>
            <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17.5 3h3l-6.6 7.5L21.6 21h-6l-4.7-6.1L5.5 21h-3l7.1-8.1L2.4 3h6.1l4.2 5.6z" />
            </svg>
            @{x.handle.replace(/^@/, "")}
            <span className="live" style={{ marginLeft: "2px" }}></span>
          </span>
        ) : (
          <Link href="/app/settings#settings-connected-accounts" className="pill" style={{ textDecoration: "none" }}>
            <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17.5 3h3l-6.6 7.5L21.6 21h-6l-4.7-6.1L5.5 21h-3l7.1-8.1L2.4 3h6.1l4.2 5.6z" />
            </svg>
            Connect X
          </Link>
        )}
        {linkedin ? null : (
          <Link href="/app/settings#settings-connected-accounts" className="pill" style={{ textDecoration: "none" }}>
            <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
              <rect width="4" height="12" x="2" y="9" />
              <circle cx="4" cy="4" r="2" />
            </svg>
            Connect LinkedIn
          </Link>
        )}
        <div style={{ flex: "1 1 auto" }}></div>
        <nav className="td-views" aria-label="View">
          {views.map((v) => (
            <Link key={v.id} href={v.href} aria-current={current === v.id ? "page" : undefined} onMouseEnter={readAhead(v.id)} onFocus={readAhead(v.id)}>
              {v.icon}
              {v.label}
            </Link>
          ))}
        </nav>
        <div style={{ flex: "1 1 auto" }}></div>
        <AutopilotSwitch />
        <Link href="/app/billing" className="pill" style={{ textDecoration: "none" }}>
          <CoinIcon />
          {creditsLabel}
        </Link>
        <button type="button" className="pill" aria-pressed={logsOpen} onClick={onLogs}>
          <LogsIcon />
          <span className="td-pill-label">Logs</span>
        </button>
        <Link href="/app/studio" className="ib" aria-label="Open the editor">
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
            <path d="m6.2 5.3 3.1 3.9" />
            <path d="m12.4 3.4 3.1 4" />
            <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
        </Link>
        <Avatar email={email} />
      </header>
    );
  }

  return (
    <header className="top">
      <Project menu={MORE} />
      {variant.trail.map((step, index) => (
        <span key={step.label} className={index === variant.trail.length - 1 ? "td-crumb is-last" : "td-crumb"} style={{ display: "contents" }}>
          <span className="meta">/</span>
          {step.href ? (
            <Link href={step.href} style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--muted)", textDecoration: "none", fontSize: "13.5px" }}>
              {step.label}
            </Link>
          ) : (
            <span style={{ fontSize: "13.5px", fontWeight: "500" }}>{step.label}</span>
          )}
        </span>
      ))}
      <div style={{ flex: "1 1 auto" }}></div>
      {variant.credits ? (
        <Link href="/app/billing" className="pill" style={{ textDecoration: "none" }}>
          <CoinIcon />
          {creditsLabel}
        </Link>
      ) : null}
      {variant.logs ? (
        <button type="button" className="pill" aria-pressed={logsOpen} onClick={onLogs}>
          <LogsIcon />
          <span className="td-pill-label">Logs</span>
        </button>
      ) : null}
      {variant.back ? (
        <Link href="/app" className="pill" style={{ textDecoration: "none" }}>
          <span>
            Back<span className="td-pill-more"> to today</span>
          </span>
        </Link>
      ) : null}
      {variant.chat ? (
        <button type="button" className="pill" onClick={onChat}>
          <ChatIcon />
          <span className="td-pill-label">Chat</span>
        </button>
      ) : null}
      <Avatar email={email} />
    </header>
  );
}
