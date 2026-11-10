"use client";

import { useEffect, useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { Button } from "@/components/ui";
import { HEARD_FROM, POST_PLATFORMS, type OnboardingStatus } from "@/lib/cmo/onboard-status";

import { ErrorNote } from "../parts";

/**
 * Three optional questions while onboarding runs (CMO review 3, 3.2): the X handle, the platforms the founder posts
 * on, how they heard of OpenCMO. Skip hides them; nothing waits on them. Saved through `cmo_onboarding_answers`, which
 * puts the handle and the platforms into the documents the CMO reads (the plan reads them if it has not started yet,
 * the next one otherwise).
 */
export function SetupQuestions({ status }: { status: OnboardingStatus }) {
  const [handle, setHandle] = useState(status.answers.xHandle ?? "");
  const [handleTouched, setHandleTouched] = useState(Boolean(status.answers.xHandle));
  const [platforms, setPlatforms] = useState<string[]>(status.answers.platforms ?? []);
  const [heard, setHeard] = useState(status.answers.heardFrom ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"open" | "saving" | "saved" | "skipped">("open");
  const [error, setError] = useState<string | null>(null);

  // The CMO may find the handle on the website while the founder is still here: prefill it, unless they typed one.
  useEffect(() => {
    if (!handleTouched && status.suggestedHandle) setHandle(status.suggestedHandle);
  }, [status.suggestedHandle, handleTouched]);

  if (state === "skipped") return null;
  if (state === "saved") {
    return (
      <aside className="v2-panel td-setup-next" data-testid="setup-questions-saved">
        <div className="v2-panel-body">
          <p role="status">Saved. Your CMO plans with these answers.</p>
        </div>
      </aside>
    );
  }

  async function save() {
    const answers: Record<string, unknown> = {};
    if (handle.trim()) answers.x_handle = handle.trim();
    if (platforms.length) answers.platforms = platforms;
    if (heard) {
      answers.heard_from = heard;
      if (heard === "other" && note.trim()) answers.heard_from_note = note.trim();
    }
    if (!Object.keys(answers).length) {
      setState("skipped");
      return;
    }
    setState("saving");
    setError(null);
    try {
      await api("/cmo/onboarding/answers", jsonBody(answers));
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answers.");
      setState("open");
    }
  }

  return (
    <aside className="v2-panel td-setup-next" aria-labelledby="setup-questions-title" data-testid="setup-questions">
      <form
        className="v2-panel-body td-setup-questions"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="setup-questions-title" className="v2-panel-title">
          While you wait (optional)
        </h2>
        <label className="v2-field" htmlFor="setup-handle">
          Your X handle
          <input
            id="setup-handle"
            className="v2-input"
            type="text"
            placeholder="@yourhandle"
            autoComplete="off"
            value={handle}
            onChange={(event) => {
              setHandleTouched(true);
              setHandle(event.target.value);
            }}
          />
        </label>
        <fieldset className="td-setup-fieldset">
          <legend>Where do you post?</legend>
          {POST_PLATFORMS.map((platform) => (
            <label key={platform.id} className="td-setup-check">
              <input
                type="checkbox"
                checked={platforms.includes(platform.id)}
                onChange={(event) =>
                  setPlatforms((list) => (event.target.checked ? [...list, platform.id] : list.filter((id) => id !== platform.id)))
                }
              />
              {platform.label}
            </label>
          ))}
        </fieldset>
        <label className="v2-field" htmlFor="setup-heard">
          How did you hear about OpenCMO?
          <select id="setup-heard" className="v2-input" value={heard} onChange={(event) => setHeard(event.target.value)}>
            <option value="">Pick one</option>
            {HEARD_FROM.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {heard === "other" ? (
          <label className="v2-field" htmlFor="setup-heard-note">
            Where?
            <input id="setup-heard-note" className="v2-input" type="text" maxLength={100} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        ) : null}
        {error && <ErrorNote>{error}</ErrorNote>}
        <span className="v2-actions">
          <Button type="submit" variant="primary" disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" disabled={state === "saving"} onClick={() => setState("skipped")}>
            Skip
          </Button>
        </span>
      </form>
    </aside>
  );
}
