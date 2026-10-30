"use client";

/**
 * The processing screen for an uploaded video.
 *
 * Still NO percentage bar: the worker does not record per-step progress, so any % here would be
 * invented — see the note in `Elapsed.tsx`. What is real is the stage the worker writes.
 */

import { Elapsed } from "@/components/Elapsed";
import type { Project } from "@/lib/clipping-types";

/** The worker's real stages; no guessed percentage or ETA. */
export const STAGE_NAMES: Record<string, string> = {
  queued: "Waiting for a worker",
  probe: "Reading your video…",
  download: "Getting your video ready…",
  render: "Preparing it for the editor…",
  transcribe: "Creating the transcript…",
  done: "Ready",
  failed: "Needs attention",
  cancelled: "Cancelled",
};

const WORKING = "Preparing your video…";

/** The steps light up from `project.stage` — what the worker really writes. */
const STEPS: { label: string; stages: string[] }[] = [
  { label: "Read", stages: ["probe", "download"] },
  { label: "Prepare", stages: ["render", "reframe"] },
  { label: "Transcribe", stages: ["transcribe"] },
];

function StageSteps({ project }: { project: Project }) {
  const current = project.status === "queued"
    ? -1
    : STEPS.findIndex((step) => step.stages.includes(project.stage));
  return (
    <ol className="stage-steps" aria-hidden="true">
      {STEPS.map((step, index) => (
        <li
          key={step.label}
          className={index < current ? "is-done" : index === current ? "is-current" : undefined}
        >
          <span className="stage-step-mark" />
          {step.label}
        </li>
      ))}
    </ol>
  );
}

export function stageLabel(project: Pick<Project, "status" | "stage">): string {
  if (["done", "failed", "cancelled", "queued"].includes(project.status)) {
    return STAGE_NAMES[project.status];
  }
  return STAGE_NAMES[project.stage] ?? (project.status === "running" ? WORKING : "Processing");
}

export function ProcessingView({
  project,
  busy,
  onCancel,
}: {
  project: Project;
  busy: boolean;
  onCancel: () => void;
}) {
  const queued = project.status === "queued";
  return (
    <div className="processing-panel" role="status" aria-live="polite">
      <div className="processing-head">
        <div className="processing-thumb is-empty" aria-hidden="true">
          <span>{project.source_name.slice(0, 40)}</span>
        </div>
        <div className="processing-status">
          <h2>{stageLabel(project)}</h2>
          <p className="processing-count">It opens in the editor when it is ready.</p>
          <Elapsed since={project.attempt_started_at ?? project.created_at} />
        </div>
      </div>

      <StageSteps project={project} />

      <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
        {queued ? "Remove from queue" : "Cancel processing"}
      </button>
    </div>
  );
}
