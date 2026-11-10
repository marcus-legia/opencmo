"use client";

import Link from "next/link";
import { useRef } from "react";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";

import { Logo } from "./Logo";

/**
 * The top bar (canvas Main.dc.html): brand, the open tabs, then credits, Logs, the editor, the chat and the account.
 * It spans the three columns, so these are on screen whatever the rail and chat are doing.
 */
export function TopBar({
  tabs,
  credits,
  email,
  logsOpen,
  onLogs,
  onChat,
}: {
  tabs: ReactNode;
  credits: number | null;
  email: string | null;
  logsOpen: boolean;
  onLogs: () => void;
  onChat: () => void;
}) {
  const initial = (email ?? "?").trim().charAt(0).toUpperCase() || "?";
  const menu = useRef<HTMLDetailsElement>(null);
  // A menu entry that opens something else closes the menu first, so it is not left open behind or after it.
  const fromMenu = (open: () => void) => () => {
    if (menu.current) menu.current.open = false;
    open();
  };
  return (
    <header className="td-top">
      <Link href="/app" className="td-brand" aria-label="OpenCMO home">
        <Logo />
        <span>OpenCMO</span>
      </Link>
      <span className="td-sep" aria-hidden="true" />
      {tabs}
      <span className="td-spacer" />
      <Link href="/app/billing" className="td-pill" aria-label={credits === null ? "Credits" : `${credits} credits left`}>
        <Icon name="coins" size={14} />
        <span className="td-num">{credits ?? "–"}</span>
        <span className="td-hide-phone">credits</span>
      </Link>
      <button type="button" className="td-pill td-hide-phone" aria-haspopup="dialog" aria-expanded={logsOpen} onClick={onLogs}>
        <Icon name="terminal" size={14} />
        Logs
      </button>
      <button type="button" className="td-pill td-hide-phone" onClick={onChat}>
        <Icon name="message-circle" size={14} />
        Chat
      </button>
      <Link href="/app/editor" className="td-icon td-hide-phone" aria-label="Open the editor" title="Editor">
        <Icon name="scissors" size={16} />
      </Link>
      <details className="td-avatar" ref={menu}>
        <summary aria-label="Account">{initial}</summary>
        <div className="td-menu">
          <span className="td-menu-email">{email ?? "Signed in"}</span>
          <Link href="/app/settings" onClick={fromMenu(() => {})}>
            <Icon name="settings" size={14} />
            Settings
          </Link>
          <Link href="/app/billing" onClick={fromMenu(() => {})}>
            <Icon name="coins" size={14} />
            Billing
          </Link>
          <button type="button" className="td-show-phone" onClick={fromMenu(onLogs)}>
            <Icon name="terminal" size={14} />
            Logs
          </button>
          <hr />
          <form action="/auth/signout" method="post">
            <button type="submit">
              <Icon name="log-out" size={14} />
              Sign out
            </button>
          </form>
        </div>
      </details>
    </header>
  );
}
