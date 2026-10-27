"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { DocumentForm, type Body } from "@/components/cmo/DocumentFields";
import { DOCUMENT_KINDS, DOCUMENTS, type DocumentKind } from "@/lib/cmo/documents";
import type { CmoState, DocumentRow } from "@/lib/cmo/state";
import { PLATFORM_LABEL } from "@/lib/screens/common";
import { SETUP_STEPS, type SetupScreen as Data } from "@/lib/screens/setup";

import { Button, ErrorNote, LinkButton, MonoLabel, Screen, SampleTag, SkeletonBlocks, cx } from "../kit";
import { useScreen } from "../useScreen";

type Step = (typeof SETUP_STEPS)[number];

const STEP_LABEL: Record<Step, string> = {
  website: "Your website",
  documents: "Check 4 documents",
  accounts: "Connect accounts",
  brand: "Brand Kit",
  goal: "First week's goal",
};

const host = (site: string) => site.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Setup (S13): five steps, replacing today's onboarding view under the flag. The website and the
 * documents are live today (`/cmo/onboarding`, `/cmo/documents`); accounts, the Brand Kit check and the
 * first goal read the screens route.
 */
export function SetupScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [docs, setDocs] = useState<CmoState | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [screen] = useScreen("setup");
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    let alive = true;
    api<CmoState>("/cmo/documents")
      .then((next) => alive && setDocs(next))
      .catch((err: unknown) => alive && setDocsError(err instanceof Error ? err.message : "Could not load your documents."));
    return () => {
      alive = false;
    };
  }, []);

  // First step: the website until documents exist; then wherever the setup data says, never before documents.
  useEffect(() => {
    if (step || !docs || screen.status === "loading") return;
    const hasDocs = DOCUMENT_KINDS.some((kind) => docs.documents[kind]);
    if (!hasDocs) return setStep("website");
    const saved = screen.status === "ready" ? screen.data.step : "documents";
    setStep(saved === "website" ? "documents" : saved);
  }, [docs, screen, step]);

  const data = screen.status === "ready" ? screen.data : null;
  const live = screen.status === "ready" ? screen.live : null;
  const index = step ? SETUP_STEPS.indexOf(step) : 0;
  const next = () => setStep(SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, index + 1)]);
  const site = docs?.lastRun?.input.site ?? data?.site ?? "";

  return (
    <Screen label="Setup" className="scr-setup">
      <div className="scr-setup-top">
        <MonoLabel>Setup</MonoLabel>
        <a href="/app" className="scr-mono-link">
          Finish later
        </a>
      </div>
      <ol className="scr-steps" aria-label="Setup steps">
        {SETUP_STEPS.map((s, i) => (
          <li key={s} className={cx(i < index && "is-done", i === index && "is-now")} aria-current={i === index ? "step" : undefined}>
            <span className="scr-mono is-small">
              {String(i + 1).padStart(2, "0")}
              {i < index ? " · done" : i === index ? " · now" : ""}
            </span>
            <b>{STEP_LABEL[s]}</b>
          </li>
        ))}
      </ol>

      {docsError && <ErrorNote>{docsError}</ErrorNote>}
      {!step && !docsError && <SkeletonBlocks rows={2} />}

      {step === "website" && (
        <WebsiteStep
          initial={params.get("site")?.slice(0, 300) ?? site}
          onDone={(state) => {
            setDocs(state);
            setStep("documents");
          }}
        />
      )}
      {step === "documents" && docs && <DocumentsStep site={site} state={docs} onState={setDocs} onDone={next} />}
      {step === "accounts" && data && <AccountsStep data={data} sample={!live?.accounts} onDone={next} />}
      {step === "brand" && data && <BrandStep has={data.hasBrandKit} sample={!live?.hasBrandKit} onDone={next} />}
      {step === "goal" && data && <GoalStep goal={data.goal} sample={!live?.goal} onDone={() => router.push("/app")} />}
    </Screen>
  );
}

function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="scr-setup-head">
      <h1>{title}</h1>
      <p>{sub}</p>
    </header>
  );
}

function StepFoot({ note, children }: { note: string; children: React.ReactNode }) {
  return (
    <div className="scr-setup-foot">
      <span className="scr-small scr-muted">{note}</span>
      <span className="scr-dialog-actions">{children}</span>
    </div>
  );
}

function WebsiteStep({ initial, onDone }: { initial: string; onDone: (state: CmoState) => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      await api("/cmo/onboarding", jsonBody({ site: value.trim() }));
      onDone(await api<CmoState>("/cmo/documents"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="scr-setup-body"
      data-testid="cmo-onboarding"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) void build();
      }}
    >
      <StepHead
        title="Start with your website."
        sub="OpenCMO reads it and drafts the four documents every department works from: what you sell, who it is for, who you compete with and what to post. You can edit every word."
      />
      <label className="scr-field" htmlFor="setup-site">
        Your website
        <input id="setup-site" className="scr-input" type="text" inputMode="url" placeholder="yourproduct.com" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {busy && (
        <p role="status" className="scr-small scr-muted">
          Reading your website and writing your documents. This usually takes under a minute.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <StepFoot note="Nothing is posted. Every draft waits for your approval.">
        <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
          {busy ? "Reading…" : "Read my website"}
        </Button>
      </StepFoot>
    </form>
  );
}

function docNote(kind: DocumentKind, row: DocumentRow | undefined): string {
  if (!row) return "Not written";
  if (kind === "product") return `${DOCUMENTS.product.fields.length} fields`;
  if (kind === "competitors") {
    const n = Array.isArray(row.body.competitors) ? row.body.competitors.length : 0;
    return `${n} found`;
  }
  return row.created_by === "agent" ? "Drafted" : "Edited";
}

function DocumentsStep({ site, state, onState, onDone }: { site: string; state: CmoState; onState: (s: CmoState) => void; onDone: () => void }) {
  const [open, setOpen] = useState<DocumentKind | null>("product");
  const [drafts, setDrafts] = useState<Partial<Record<DocumentKind, Body>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAndContinue() {
    setBusy(true);
    setError(null);
    try {
      // Only the documents the founder changed become new versions; the rest stay as Research drafted them.
      let next = state;
      for (const kind of DOCUMENT_KINDS) {
        const draft = drafts[kind];
        if (!draft) continue;
        const row = await api<DocumentRow>(`/cmo/documents/${kind}`, jsonBody({ body: draft }, "PUT"));
        next = { ...next, documents: { ...next.documents, [kind]: row } };
      }
      onState(next);
      setDrafts({});
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scr-setup-body" data-testid="cmo-documents">
      <StepHead
        title={site ? `We read ${host(site)}. Check what we got right.` : "Check what we got right."}
        sub="Every department reads these four documents. Fix anything wrong now; you can edit them later in Library."
      />
      <div className="scr-accordion">
        {DOCUMENT_KINDS.map((kind) => {
          const row = state.documents[kind];
          const expanded = open === kind;
          return (
            <section key={kind} className={cx("scr-acc", expanded && "is-open")}>
              <h2>
                <button type="button" aria-expanded={expanded} aria-controls={`setup-doc-${kind}`} onClick={() => setOpen(expanded ? null : kind)}>
                  <span>{DOCUMENTS[kind].title}</span>
                  <span className="scr-mono is-small">{drafts[kind] ? "Edited" : docNote(kind, row)}</span>
                </button>
              </h2>
              {expanded && (
                <div id={`setup-doc-${kind}`} className="scr-acc-body">
                  {row ? (
                    <DocumentForm
                      fields={DOCUMENTS[kind].fields}
                      value={drafts[kind] ?? row.body}
                      idPrefix={`setup-${kind}`}
                      onChange={(value) => setDrafts((all) => ({ ...all, [kind]: value }))}
                    />
                  ) : (
                    <p className="scr-muted">This document was not written. Read your website again from step 1.</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <StepFoot note="Next: connect X, LinkedIn, TikTok… once. Posts only go out after you approve them.">
        <Button variant="primary" onClick={() => void saveAndContinue()} disabled={busy}>
          {busy ? "Saving…" : "Looks right · Continue"}
        </Button>
      </StepFoot>
    </div>
  );
}

function AccountsStep({ data, sample, onDone }: { data: Data; sample: boolean; onDone: () => void }) {
  return (
    <div className="scr-setup-body">
      <StepHead title="Connect the accounts you post from." sub="Posts go out on your own accounts, only at times you approved. You can connect more later in Settings." />
      {sample && <SampleTag />}
      <div className="scr-panel">
        <div className="scr-rows">
          {data.accounts.length === 0 && <p className="scr-row scr-muted">No accounts connected yet.</p>}
          {data.accounts.map((a) => (
            <div key={a.id} className="scr-row scr-row-inline">
              <span>
                <b>{PLATFORM_LABEL[a.platform]}</b>
                {a.handle ? ` · ${a.handle}` : ""}
              </span>
              {a.status === "connected" ? (
                <span className="scr-status is-ok">Connected</span>
              ) : (
                <Button small variant="ghost" disabled title="Connecting accounts arrives with Schedule's publishing">
                  {a.status === "reconnect" ? "Reconnect" : "Connect"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
      <StepFoot note="Until an account is connected, approved posts wait for you to post them yourself.">
        <Button variant="primary" onClick={onDone}>
          Continue
        </Button>
      </StepFoot>
    </div>
  );
}

function BrandStep({ has, sample, onDone }: { has: boolean; sample: boolean; onDone: () => void }) {
  return (
    <div className="scr-setup-body">
      <StepHead
        title="Make it look like you."
        sub="Colours, fonts, captions and logo, once. Studio and the editor use them on every video."
      />
      {sample && <SampleTag />}
      <div className="scr-panel scr-panel-body scr-row-inline scr-setup-brand">
        <span>{has ? "Your Brand Kit is set. Check it any time in Library." : "No Brand Kit yet. It takes a minute."}</span>
        <LinkButton href="/app/library?tab=brand" variant="ghost">
          {has ? "Open Brand Kit" : "Set up Brand Kit"}
        </LinkButton>
      </div>
      <StepFoot note="You can skip this; videos use OpenCMO's default look until you set yours.">
        <Button variant="primary" onClick={onDone}>
          Continue
        </Button>
      </StepFoot>
    </div>
  );
}

function GoalStep({ goal, sample, onDone }: { goal: Data["goal"]; sample: boolean; onDone: () => void }) {
  const [text, setText] = useState(goal?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    if (!goal) return onDone();
    setBusy(true);
    setError(null);
    try {
      // Sample goals have no row; a live one goes through `cmo_decide_goal`.
      if (!sample) {
        await api(
          `/cmo/goals/${encodeURIComponent(goal.id)}`,
          jsonBody({ action: "approve", ...(text.trim() !== goal.text ? { goal: text.trim() } : {}) }),
        );
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the goal.");
      setBusy(false);
    }
  }

  return (
    <div className="scr-setup-body">
      <StepHead title="Pick this week's goal." sub="The Brain plans the week around one goal. Change the words if they are not yours." />
      {sample && <SampleTag />}
      {goal ? (
        <label className="scr-field" htmlFor="setup-goal">
          {goal.status === "approved" ? "Your goal" : "Your CMO proposes"}
          <input id="setup-goal" className="scr-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} disabled={goal.status === "approved"} />
        </label>
      ) : (
        <p className="scr-muted">Your CMO proposes a goal from your documents on its first plan; it shows on the Dashboard.</p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <StepFoot note="The week's plan arrives as cards on the Dashboard. Nothing goes out until you approve it.">
        <Button variant="primary" onClick={() => void approve()} disabled={busy || (!!goal && text.trim().length < 3)}>
          {goal && goal.status === "proposed" ? "Approve · Open Dashboard" : "Open Dashboard"}
        </Button>
      </StepFoot>
    </div>
  );
}
