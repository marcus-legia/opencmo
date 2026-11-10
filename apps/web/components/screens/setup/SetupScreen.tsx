"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PlanSheet, isPlanRequired } from "@/components/billing/PlanSheet";
import { api, jsonBody } from "@/components/clipping/api";
import { Icon } from "@/components/icons";
import { Button, MonoLabel } from "@/components/ui";
import { DOCUMENT_KINDS } from "@/lib/cmo/documents";
import { setupFinished, setupSteps, type OnboardingStatus } from "@/lib/cmo/onboard-status";
import type { CmoState } from "@/lib/cmo/state";

import { ErrorNote, Screen, SkeletonBlocks } from "../parts";
import { SetupQuestions } from "./SetupQuestions";

const POLL_MS = 2_000;

/**
 * Setup (S13): the website, then the work itself (CMO review 3, 3.2). The first run is free (3.1): reading the site
 * writes the four documents, then the first week's plan and drafts start at once (`lib/cmo/onboard.ts`). Setup shows
 * each real step as it ends (the run's `steps`, then the plan and draft runs, read every 2 s) and asks three optional
 * questions meanwhile. When the drafts are done it goes to the Dashboard, where Today opens with the strategy.
 *
 * Everything else is asked for later, where a task needs it: an account is connected when the first post is
 * scheduled, the Brand Kit when the first slideshow is built, and the goal comes on the week's plan card.
 */
export function SetupScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [docs, setDocs] = useState<CmoState | null>(null);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "form": the website step; "working": a run this page started or found running.
  const [phase, setPhase] = useState<"loading" | "form" | "working">("loading");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [planSheet, setPlanSheet] = useState(false);
  const endedAt = useRef<number | null>(null);
  // The run that was there before this page started one (a typo's failed run): until the new run shows up, the poll
  // must not read the old one's end as this one's.
  const previousRun = useRef<string | null>(null);

  const read = useCallback(async () => {
    const next = await api<OnboardingStatus>("/cmo/onboarding");
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([api<CmoState>("/cmo/documents"), read()])
      .then(([state, current]) => {
        if (!alive) return;
        setDocs(state);
        const started = DOCUMENT_KINDS.some((kind) => state.documents[kind]);
        if (current.run?.status === "running") setPhase("working");
        // Setup is done once the documents exist and nothing is running: the Dashboard is the home from then on.
        else if (started) router.replace("/app");
        else setPhase("form");
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "Could not load your documents."));
    return () => {
      alive = false;
    };
  }, [read, router]);

  // While working: read the steps every 2 s, and go to the Dashboard when the first drafts are done.
  useEffect(() => {
    if (phase !== "working") return;
    let alive = true;
    const tick = async () => {
      try {
        const next = await read();
        if (!alive || (next.run && next.run.id === previousRun.current)) return;
        if (next.run && next.run.status !== "running") endedAt.current ??= Date.now();
        if (next.run?.status === "failed") {
          setSubmitError(next.run.error ?? "We could not build your plan. Try again in a minute.");
          setPhase("form");
          return;
        }
        if (setupFinished(next, endedAt.current ? Date.now() - endedAt.current : 0)) router.push("/app");
      } catch {
        // A missed read is retried on the next tick.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase, read, router]);

  async function start(site: string) {
    setSubmitError(null);
    endedAt.current = null;
    previousRun.current = status?.run?.id ?? null;
    setPhase("working");
    try {
      // The request lasts as long as the documents take; the steps arrive meanwhile through the poll above.
      await api("/cmo/onboarding", jsonBody({ site }));
    } catch (err) {
      if (isPlanRequired(err)) setPlanSheet(true);
      else setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPhase("form");
    }
  }

  const steps = status ? setupSteps(status) : [];
  const site = params.get("site")?.slice(0, 300) ?? "";

  return (
    <Screen label="Setup" className="scr-setup">
      <div className="scr-setup-top td-setup-top">
        <MonoLabel>Setup</MonoLabel>
        <ol className="td-steps" aria-label="Setup steps">
          <li {...(phase === "working" ? { "data-done": "" } : { "aria-current": "step" as const })}>
            <span className="n" aria-hidden="true">
              {phase === "working" ? <Icon name="check" size={12} /> : "1"}
            </span>
            Website
          </li>
          <li {...(phase === "working" ? { "aria-current": "step" as const } : {})}>
            <span className="n">2</span>
            Documents and first week
          </li>
          <li>
            <span className="n">3</span>
            Dashboard
          </li>
        </ol>
      </div>
      {params.get("paid") === "1" && (
        <p role="status" className="scr-small scr-muted" data-testid="setup-paid">
          Payment received. Credits arrive within a minute.
        </p>
      )}
      {params.get("paid") === "pending" && (
        <p role="status" className="scr-small scr-muted" data-testid="setup-paid-pending">
          Your payment has not arrived yet. It usually takes under a minute after checkout; your first run is free either way.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {phase === "loading" && !error && <SkeletonBlocks rows={2} />}
      {phase === "form" && docs && (
        <WebsiteStep initial={site || docs.lastRun?.input.site || ""} error={submitError} onStart={(value) => void start(value)} />
      )}
      {phase === "working" && (
        <div className="td-setup">
          <section className="v2-panel td-setup-progress" aria-labelledby="setup-progress-title" data-testid="setup-progress">
            <div className="v2-panel-body">
              <h1 id="setup-progress-title" className="scr-setup-title">
                Your CMO is at work.
              </h1>
              <p className="scr-muted">This takes a minute or two. Nothing is posted: every draft waits for your approval.</p>
              <ol className="td-setup-steps" aria-live="polite">
                {steps.map((step) => (
                  <li key={step.id} data-state={step.state} data-testid="setup-step">
                    <span className="td-setup-dot" aria-hidden="true">
                      {step.state === "done" ? <Icon name="check" size={12} /> : step.state === "failed" ? "!" : null}
                    </span>
                    <span>{step.label}</span>
                    <span className="v2-mono is-muted td-setup-state">
                      {step.state === "done" ? "Done" : step.state === "running" ? "Working" : step.state === "failed" ? "Did not finish" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          {status ? <SetupQuestions status={status} /> : null}
        </div>
      )}
      <PlanSheet open={planSheet} onClose={() => setPlanSheet(false)} action="read your website again" />
    </Screen>
  );
}

function WebsiteStep({ initial, error, onStart }: { initial: string; error: string | null; onStart: (site: string) => void }) {
  const [value, setValue] = useState(initial);

  return (
    <div className="td-setup">
      <form
        className="scr-setup-body"
        data-testid="cmo-onboarding"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onStart(value.trim());
        }}
      >
        <header className="scr-setup-head">
          <h1>Start with your website.</h1>
          <p>
            Your CMO reads it, writes the four documents every department works from, then plans your first week and drafts
            your first posts. This first run is free. You can edit every word later in Library.
          </p>
        </header>
        <label className="v2-field" htmlFor="setup-site">
          Your website
          <input id="setup-site" className="v2-input" type="text" inputMode="url" placeholder="yourproduct.com" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="scr-setup-foot">
          <span className="scr-small scr-muted">Nothing is posted. Every draft waits for your approval.</span>
          <span className="v2-actions">
            <Button type="submit" variant="primary" disabled={!value.trim()}>
              Read my website
            </Button>
          </span>
        </div>
      </form>
      <aside className="v2-panel td-setup-next" aria-labelledby="setup-next-title">
        <div className="v2-panel-body">
          <h2 id="setup-next-title" className="v2-panel-title">What happens next</h2>
          <ol className="td-setup-list">
            <li>Your CMO reads the site and writes Product, Strategy, Competitors and Content plan.</li>
            <li>Writer plans your first week and drafts your first posts.</li>
            <li>You read them on the Dashboard. To approve and post, you pick a plan.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
