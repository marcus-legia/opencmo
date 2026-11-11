"use client";

/**
 * What used to be the Brain and Library pages, as panes of the Context drawer over the feed (owner, 2026-11-10: fewer
 * page jumps). The panes are those pages' own parts, so nothing they did is lost: the week's orders and measures, what
 * the CMO learned, past weeks, the voice rules and notes, the skills. Loaded only when one is open.
 */

import { useState } from "react";

import { BrainBody } from "@/components/screens/brain/BrainScreen";
import { PauseButton } from "@/components/screens/brain/PauseButton";
import { Gate, SkillsTab, VoicePageView, VoiceTab } from "@/components/screens/library/LibraryScreen";
import { ErrorNote, SkeletonBlocks } from "@/components/screens/parts";
import { useScreen, type ScreenState } from "@/components/screens/useScreen";

export type BrainPaneId = "plan" | "learned" | "past";
const BRAIN_TAB = { plan: "week", learned: "memory", past: "past" } as const;

/** `state`: the drawer already reads the brain screen (its "What your CMO learned" list); the pane shows that read. */
export function BrainPane({ pane, state }: { pane: BrainPaneId; state: ScreenState<"brain"> }) {
  const [pausedOverride, setPausedOverride] = useState<string | null | undefined>(undefined);
  if (state.status === "loading") return <SkeletonBlocks />;
  if (state.status === "error") return <ErrorNote>{state.message}</ErrorNote>;
  const pausedAt = pausedOverride !== undefined ? pausedOverride : state.data.cmo.pausedAt;
  return (
    <>
      {pane === "plan" ? (
        <div className="td-pane-actions">
          <span className="meta">
            {pausedAt
              ? `Paused since ${new Date(pausedAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Nothing runs until you resume.`
              : "Your CMO plans the week on Monday and checks it every morning."}
          </span>
          <PauseButton pausedAt={pausedAt} live={state.live.cmo} onChange={setPausedOverride} />
        </div>
      ) : null}
      <BrainBody data={state.data} tab={BRAIN_TAB[pane]} />
    </>
  );
}

export function LibraryPane({ pane }: { pane: "voice" | "skills" }) {
  const [screen] = useScreen("library");
  if (pane === "voice") {
    return (
      <VoicePageView>
        <Gate screen={screen}>{(data, sample) => <VoiceTab voice={data.voice} sample={sample} />}</Gate>
      </VoicePageView>
    );
  }
  return <Gate screen={screen}>{(data, sample) => <SkillsTab skills={data.skills} sample={sample} />}</Gate>;
}
