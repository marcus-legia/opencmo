"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { Icon } from "@/components/icons";
import { Button, MonoLabel } from "@/components/ui";
import { DOCUMENT_KINDS } from "@/lib/cmo/documents";
import type { CmoState } from "@/lib/cmo/state";

import { ErrorNote, Screen, SkeletonBlocks } from "../parts";

/**
 * Setup (S13), cut to one step (cmo-review-2 S2.2): the website. Reading it writes the four documents, then the first
 * week's plan and draft start at once (`lib/cmo/onboard.ts`), and the founder watches them arrive on the Dashboard.
 *
 * Everything else is asked for later, where a task needs it: the documents are checked and edited in Library, an
 * account is connected when the first post is scheduled, the Brand Kit when the first slideshow is built, and the goal
 * comes on the week's plan card.
 */
export function SetupScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [docs, setDocs] = useState<CmoState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<CmoState>("/cmo/documents")
      .then((next) => alive && setDocs(next))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "Could not load your documents."));
    return () => {
      alive = false;
    };
  }, []);

  // Setup is done once the documents exist: the Dashboard is the home from then on.
  const done = !!docs && DOCUMENT_KINDS.some((kind) => docs.documents[kind]);
  useEffect(() => {
    if (done) router.replace("/app");
  }, [done, router]);

  return (
    <Screen label="Setup" className="scr-setup">
      <div className="scr-setup-top td-setup-top">
        <MonoLabel>Setup</MonoLabel>
        {/* The real order: a plan is picked before Setup (paid first), the website here, the first week on the Dashboard. */}
        <ol className="td-steps" aria-label="Setup steps">
          <li data-done="">
            <span className="n" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
            Plan
          </li>
          <li aria-current="step">
            <span className="n">2</span>
            Website
          </li>
          <li>
            <span className="n">3</span>
            First week
          </li>
        </ol>
      </div>
      {params.get("paid") === "1" && (
        <p role="status" className="scr-small scr-muted" data-testid="setup-paid">
          Payment received.
        </p>
      )}
      {params.get("paid") === "pending" && (
        <p role="status" className="scr-small scr-muted" data-testid="setup-paid-pending">
          Waiting for your payment to arrive. It usually takes under a minute after checkout. Not paid yet?{" "}
          <a href="/app/billing?start=1">Pick a plan</a>.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!docs && !error && <SkeletonBlocks rows={2} />}
      {docs && !done && <WebsiteStep initial={params.get("site")?.slice(0, 300) ?? docs.lastRun?.input.site ?? ""} onDone={() => router.push("/app")} />}
    </Screen>
  );
}

function WebsiteStep({ initial, onDone }: { initial: string; onDone: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      await api("/cmo/onboarding", jsonBody({ site: value.trim() }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="td-setup">
    <form
      className="scr-setup-body"
      data-testid="cmo-onboarding"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) void build();
      }}
    >
      <header className="scr-setup-head">
        <h1>Start with your website.</h1>
        <p>
          Your CMO reads it, writes the four documents every department works from, then plans your first week and drafts
          the first post. You can edit every word later in Library.
        </p>
      </header>
      <label className="v2-field" htmlFor="setup-site">
        Your website
        <input id="setup-site" className="v2-input" type="text" inputMode="url" placeholder="yourproduct.com" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {busy && (
        <p role="status" className="scr-small scr-muted">
          Reading your website and writing your documents. This usually takes under a minute; the plan and the first draft
          follow on your Dashboard.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="scr-setup-foot">
        <span className="scr-small scr-muted">Nothing is posted. Every draft waits for your approval.</span>
        <span className="v2-actions">
          <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
            {busy ? "Reading…" : "Read my website"}
          </Button>
        </span>
      </div>
    </form>
    <aside className="v2-panel td-setup-next" aria-labelledby="setup-next-title">
      <div className="v2-panel-body">
        <h2 id="setup-next-title" className="v2-panel-title">What happens next</h2>
        <ol className="td-setup-list">
          <li>Your CMO reads the site and writes Product, Strategy, Competitors and Content plan.</li>
          <li>Writer plans your first week and drafts the first post.</li>
          <li>You approve what you like on the Dashboard. Accounts are connected when the first post is scheduled.</li>
        </ol>
      </div>
    </aside>
    </div>
  );
}
