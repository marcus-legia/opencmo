"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Monthly → annual (`POST /api/v1/billing/switch`, A7). Creem charges the prorated difference at once and the webhook
 * moves the plan a few seconds later, so the button asks once, says "Switching…", then reloads the page's numbers.
 */
export function SwitchAnnual({ billed }: { billed: number }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setStep("busy");
    setError(null);
    const response = await fetch("/api/v1/billing/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product: "annual" }),
    }).catch(() => null);
    if (response?.ok) {
      setStep("done");
      // The plan changes when Creem's webhook lands: read the page again a little later.
      window.setTimeout(() => router.refresh(), 4000);
      return;
    }
    const data = (await response?.json().catch(() => null)) as { detail?: string } | null;
    setError(data?.detail ?? "Could not switch your plan. Please try again.");
    setStep("confirm");
  }

  if (step === "done") {
    return (
      <span className="meta" role="status">
        Switching to annual. Your plan updates in a few seconds.
      </span>
    );
  }
  if (step === "idle") {
    return (
      <button type="button" className="ghost" onClick={() => setStep("confirm")}>
        Switch to annual
      </button>
    );
  }
  return (
    <div role="group" aria-label="Switch to annual" style={{ display: "flex", flexDirection: "column", gap: "6px", flexBasis: "100%" }}>
      <span className="meta">
        Annual is ${billed} a year. Creem charges the prorated difference now, and your allowance stays monthly.
      </span>
      {error ? (
        <span className="meta" role="alert" style={{ color: "var(--warn)" }}>
          {error}
        </span>
      ) : null}
      <span style={{ display: "flex", gap: "8px" }}>
        <button type="button" className="skip" disabled={step === "busy"} onClick={() => setStep("idle")}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={step === "busy"} onClick={() => void go()}>
          {step === "busy" ? "Switching…" : "Switch and pay the difference"}
        </button>
      </span>
    </div>
  );
}
