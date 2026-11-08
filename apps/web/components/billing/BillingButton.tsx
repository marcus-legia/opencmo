"use client";

import { useState } from "react";

/** Asks our API for a Creem URL (checkout or portal) and goes there. The server decides what may be bought. */
export function BillingButton({ path, product, site, label, className }: { path: string; product?: string; site?: string; label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(product ? { product, ...(site ? { site } : {}) } : {}),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as { checkout_url?: string; url?: string; detail?: string } | null;
    const url = response?.ok ? (data?.checkout_url ?? data?.url) : undefined;
    if (url) {
      window.location.assign(url);
      return;
    }
    setBusy(false);
    setError(data?.detail ?? "Something went wrong. Please try again.");
  }

  return (
    <>
      <button type="button" className={className ?? "primary-button plan-cta"} onClick={go} disabled={busy}>
        {busy ? "One moment…" : label}
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </>
  );
}
