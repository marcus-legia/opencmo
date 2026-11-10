"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PlanSheet, isPlanRequired } from "@/components/billing/PlanSheet";
import { api, jsonBody } from "@/components/clipping/api";
import { Icon } from "@/components/icons";
import { DOCUMENT_KINDS } from "@/lib/cmo/documents";
import { setupFinished, setupSteps, type OnboardingStatus } from "@/lib/cmo/onboard-status";
import type { CmoState } from "@/lib/cmo/state";

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
  const doneCount = steps.filter((x) => x.state === "done").length;
  // The real order (cmo-review-3): the website, the documents and first week the CMO writes from it, then the feed.
  // A plan is asked for on the first decision, an account when the first post is scheduled: neither is a Setup step.
  const stepper = [
    { n: 1, label: "Website", cur: phase !== "working", done: phase === "working" },
    { n: 2, label: "What it learned", cur: phase === "working", done: false },
    { n: 3, label: "First week", cur: false, done: false },
  ];

  return (
    <>
      <header style={{ height: "56px", display: "flex", alignItems: "center", gap: "10px", padding: "0 24px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", borderRadius: "6px", background: "var(--text)", color: "var(--bg)", fontWeight: "700", fontSize: "12px" }}>O</span>
        <span style={{ fontWeight: "600" }}>OpenCMO</span>
        <div style={{ flex: "1 1 auto" }}></div>
        <nav className="stepper" aria-label="Setup steps">
          {stepper.map((x) => (
            <button key={x.n} type="button" aria-current={x.cur ? "step" : undefined} data-done={x.done ? "true" : "false"} tabIndex={-1}>
              <span className="n">{x.done ? <Icon name="check" size={12} /> : x.n}</span>
              {x.label}
            </button>
          ))}
        </nav>
      </header>

      <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "56px 24px 48px" }} data-testid="v2-setup">
        {params.get("paid") === "1" && (
          <p role="status" className="meta" data-testid="setup-paid" style={{ marginBottom: "16px" }}>
            Payment received. Credits arrive within a minute.
          </p>
        )}
        {params.get("paid") === "pending" && (
          <p role="status" className="meta" data-testid="setup-paid-pending" style={{ marginBottom: "16px" }}>
            Your payment has not arrived yet. It usually takes under a minute after checkout; your first run is free either way.
          </p>
        )}
        {error ? <p className="meta">{error}</p> : null}
        {phase === "loading" && !error ? <p className="meta">Loading…</p> : null}
        {phase === "form" && docs ? <WebsiteStep initial={site || docs.lastRun?.input.site || ""} error={submitError} onStart={(value) => void start(value)} /> : null}
        {phase === "working" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "32px", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 420px", minWidth: "0" }}>
              <div className="meta" style={{ marginBottom: "10px" }}>
                Step 2 of 3{status?.suggestedHandle ? ` · @${status.suggestedHandle}` : ""}
              </div>
              <h1>Your CMO is reading your website.</h1>
              <p className="lead">It writes the documents every agent works from, then plans your first week and drafts your first posts. Nothing is posted: every draft waits for your approval.</p>
              {status ? (
                <div className="card v2" style={{ marginTop: "24px" }}>
                  <SetupQuestions status={status} />
                </div>
              ) : null}
            </div>
            <div className="card" style={{ flex: "1 1 320px", maxWidth: "400px" }} data-testid="setup-progress">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                <span style={{ fontWeight: "600" }}>Your documents</span>
                <span className="meta">
                  {doneCount} of {steps.length}
                </span>
              </div>
              <div aria-live="polite">
                {steps.map((step) => (
                  <div key={step.id} className="task" data-state={step.state} data-testid="setup-step">
                    <span className={step.state === "done" ? "dot d-ok" : step.state === "running" ? "dot d-run" : "dot d-wait"}>
                      {step.state === "done" ? (
                        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "12px", height: "12px" }}>
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : step.state === "running" ? (
                        <svg className="i s spin" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "12px", height: "12px" }}>
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      ) : step.state === "failed" ? (
                        "!"
                      ) : null}
                    </span>
                    <span style={{ flex: "1", color: step.state === "waiting" ? "var(--muted)" : undefined }}>{step.label}</span>
                    <span className="meta">{step.state === "done" ? "done" : step.state === "running" ? "writing" : step.state === "failed" ? "did not finish" : "next"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <PlanSheet open={planSheet} onClose={() => setPlanSheet(false)} action="read your website again" />
    </>
  );
}

function WebsiteStep({ initial, error, onStart }: { initial: string; error: string | null; onStart: (site: string) => void }) {
  const [value, setValue] = useState(initial);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "48px", alignItems: "flex-start" }}>
      <form
        style={{ flex: "1 1 420px", minWidth: "0" }}
        data-testid="cmo-onboarding"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onStart(value.trim());
        }}
      >
        <div className="meta" style={{ marginBottom: "10px" }}>
          Step 1 of 3
        </div>
        <h1>Start with your website.</h1>
        <p className="lead">Your CMO reads it and writes the four documents every agent works from: Product, Strategy, Competitors and Content plan. You can change any of them later.</p>
        <div style={{ marginTop: "28px", display: "flex", flexDirection: "column", gap: "10px", maxWidth: "520px" }}>
          <label htmlFor="setup-site" style={{ fontSize: "12.5px", fontWeight: "500" }}>
            Your website
          </label>
          <div className="field">
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "var(--subtle)" }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
              <path d="M2 12h20" />
            </svg>
            <input id="setup-site" type="text" inputMode="url" placeholder="yourproduct.com" value={value} onChange={(e) => setValue(e.target.value)} />
            <button type="submit" className="primary" disabled={!value.trim()}>
              Read my website
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          </div>
          <span className="meta">Free. It reads public pages only and takes about a minute.</span>
          {error ? <span className="meta" role="alert" style={{ color: "var(--warn)" }}>{error}</span> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "28px", color: "var(--muted)" }}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          </svg>
          <span style={{ fontSize: "13px" }}>Nothing is posted. Every draft waits for your approval.</span>
        </div>
      </form>
      <div className="card" style={{ flex: "1 1 340px", maxWidth: "420px" }}>
        <div style={{ fontWeight: "600", marginBottom: "12px" }}>What happens next</div>
        <div className="task">
          <span className="dot d-wait mono" style={{ fontSize: "11px" }}>1</span>
          <span style={{ flex: "1" }}>Your CMO reads the site and writes your documents.</span>
        </div>
        <div className="task">
          <span className="dot d-wait mono" style={{ fontSize: "11px" }}>2</span>
          <span style={{ flex: "1" }}>Writer plans your first week and drafts your first posts. This first run is free.</span>
        </div>
        <div className="task">
          <span className="dot d-wait mono" style={{ fontSize: "11px" }}>3</span>
          <span style={{ flex: "1" }}>You read them in your feed. To approve and post, you pick a plan.</span>
        </div>
      </div>
    </div>
  );
}
