/**
 * What Setup shows while onboarding runs (CMO review 3, 3.2): the run's real steps, then the first plan and the first
 * drafts, which are runs of their own. Pure types and wording, shared by the route and the screen.
 */

export type RunState = "queued" | "running" | "done" | "failed";
export type StepState = "running" | "done" | "failed";

export type OnboardingStatus = {
  /** The latest onboarding run, or null before the first one. */
  run: { id: string; status: "running" | "done" | "failed"; error: string | null; steps: { id: string; status: StepState }[]; createdAt: string } | null;
  /** The first week's plan and drafts started after that run; null when none has started. */
  plan: RunState | null;
  draft: RunState | null;
  answers: { xHandle: string | null; platforms: string[] | null; heardFrom: string | null };
  /** The Product document's X handle, to prefill the question once the CMO found it. */
  suggestedHandle: string | null;
};

export type SetupStep = { id: string; label: string; state: "waiting" | StepState };

const LABELS: Record<string, string> = {
  site: "Reading your website",
  product: "Writing your Product document",
  strategy: "Writing your Strategy",
  competitors: "Writing your Competitors",
  content_strategy: "Writing your Content plan",
  plan: "Planning your week",
  draft: "Drafting today's posts",
};

const ORDER = ["site", "product", "strategy", "competitors", "content_strategy", "plan", "draft"] as const;

const runStep = (state: RunState | null): SetupStep["state"] => (state === "done" ? "done" : state === "failed" ? "failed" : state === "running" || state === "queued" ? "running" : "waiting");

/** The seven steps Setup lists, each in its real state. */
export function setupSteps(status: OnboardingStatus): SetupStep[] {
  const fromRun = new Map((status.run?.steps ?? []).map((step) => [step.id, step.status]));
  return ORDER.map((id) => {
    const state: SetupStep["state"] = id === "plan" ? runStep(status.plan) : id === "draft" ? runStep(status.draft) : (fromRun.get(id) ?? "waiting");
    return { id, label: LABELS[id]!, state };
  });
}

/** How long Setup waits for the first plan and drafts after the documents are saved. */
export const SETUP_MAX_WAIT_MS = 120_000;

/**
 * Whether Setup is done and goes to the Dashboard: the drafts ended, or the documents are saved and no plan followed
 * (an account that cannot plan: the documents are still worth reading). `settledMs`: time since the run ended.
 */
export function setupFinished(status: OnboardingStatus, settledMs: number): boolean {
  if (!status.run || status.run.status === "running") return false;
  if (status.run.status === "failed") return false;
  // The documents are saved; whatever is still on its way (a slow sweep, a plan still running)
  // shows on the Dashboard. Setup never keeps the founder longer than this.
  if (settledMs > SETUP_MAX_WAIT_MS) return true;
  if (status.draft === "done" || status.draft === "failed") return true;
  if (status.plan === "failed") return true;
  // The draft is queued when the plan is done (`cmo_runs_first_draft`); give the sweep a moment before leaving.
  return status.plan === null ? settledMs > 15_000 : status.plan === "done" && status.draft === null && settledMs > 60_000;
}

export const HEARD_FROM = [
  { id: "search", label: "Google or another search" },
  { id: "ai_assistant", label: "ChatGPT, Claude or another AI" },
  { id: "x", label: "X" },
  { id: "reddit", label: "Reddit" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "youtube", label: "YouTube" },
  { id: "friend", label: "A friend" },
  { id: "newsletter", label: "A newsletter" },
  { id: "other", label: "Other" },
] as const;

export const POST_PLATFORMS = [
  { id: "x", label: "X" },
  { id: "threads", label: "Threads" },
  { id: "linkedin", label: "LinkedIn" },
] as const;
