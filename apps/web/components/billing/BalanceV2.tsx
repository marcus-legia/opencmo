"use client";

import { useShellAccount } from "@/components/clipping/web/WebShell";

/** The balance the shell already loaded (and refreshes after a job): Billing asks for it again from nowhere. */
export function BalanceV2() {
  const { credits } = useShellAccount();
  return <span className="td-billing-balance-n v2-num">{credits ?? "–"}</span>;
}
