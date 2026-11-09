"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

import { Icon } from "@/components/icons";
import type { ScriptBeat } from "@/lib/cmo/writer/types";

const SHOT_LABEL: Record<ScriptBeat["shot"], string> = { talking_head: "To camera", screen: "Screen", broll: "You film" };
const SHOT_ICON = { talking_head: "video", screen: "monitor", broll: "film" } as const;

/** Keeps the screen on while the prompter is open, where the browser allows it; a refusal changes nothing else. */
function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
    let lock: Sentinel | null = null;
    const take = () => {
      if (document.visibilityState !== "visible" || !nav.wakeLock) return;
      nav.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    take();
    // The browser drops the lock when the tab hides; take it again when the founder comes back.
    document.addEventListener("visibilitychange", take);
    return () => {
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/**
 * One beat at a time, in large type, for a phone held upright. Tap the right half (or swipe left) for the next beat,
 * the left half for the previous one. Auto-scroll moves on at the beat's own pace: its seconds.
 */
export function Prompter({ title, beats }: { title: string; beats: ScriptBeat[] }) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const swipe = useRef<number | null>(null);
  // A swipe also ends in a click on the tap zone under it; this keeps that click from moving a second beat.
  const swiped = useRef(false);
  useWakeLock();

  const beat = beats[index]!;
  const total = beats.reduce((sum, b) => sum + b.seconds, 0);
  const last = index === beats.length - 1;
  const go = (step: number) => setIndex((i) => Math.min(beats.length - 1, Math.max(0, i + step)));

  useEffect(() => {
    if (!auto) return;
    if (last) {
      setAuto(false);
      return;
    }
    const timer = window.setTimeout(() => go(1), beat.seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [auto, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (event: PointerEvent) => {
    swipe.current = event.clientX;
  };
  const onUp = (event: PointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (from === null) return;
    const dx = event.clientX - from;
    swiped.current = Math.abs(dx) > 40;
    if (swiped.current) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="v2 td-prompter" data-testid="prompter">
      <header className="td-prompter-head">
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div className="v2-mono is-muted">Script · {total} s · you film</div>
          <div className="td-prompter-title">{title}</div>
        </div>
        <Link href="/app/studio" className="td-icon" aria-label="Close the prompter">
          <Icon name="x" size={20} />
        </Link>
      </header>
      <div style={{ padding: "0 16px" }}>
        <div className="td-prompter-segs" aria-hidden="true">
          {beats.map((_, i) => (
            <i key={i} data-on={i <= index ? "" : undefined} />
          ))}
        </div>
        <div className="td-prompter-count">
          <span className="v2-num" aria-live="polite">
            Beat {index + 1} of {beats.length}
          </span>
          <span className="v2-num">{beat.seconds} s</span>
        </div>
      </div>
      <div className="td-prompter-stage" onPointerDown={onDown} onPointerUp={onUp}>
        <span className="td-prompter-kind">
          <Icon name={SHOT_ICON[beat.shot]} size={15} />
          {SHOT_LABEL[beat.shot]}
        </span>
        <p className="td-prompter-show">Show: {beat.show}</p>
        <p className="td-prompter-words">{beat.say}</p>
        <button type="button" className="td-prompter-tap is-prev" aria-label="Previous beat" tabIndex={-1} onClick={() => (swiped.current ? (swiped.current = false) : go(-1))} />
        <button type="button" className="td-prompter-tap is-next" aria-label="Next beat" tabIndex={-1} onClick={() => (swiped.current ? (swiped.current = false) : go(1))} />
      </div>
      <footer className="td-prompter-foot">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="td-prompter-nav" aria-label="Previous beat" disabled={index === 0} onClick={() => go(-1)}>
            <Icon name="chevron-left" size={22} />
          </button>
          <button type="button" className="td-prompter-play" aria-pressed={auto} onClick={() => setAuto((a) => !a)} disabled={last && !auto}>
            <Icon name={auto ? "pause" : "play"} size={18} />
            {auto ? "Scrolling at the beat's pace" : "Auto-scroll"}
          </button>
          <button type="button" className="td-prompter-nav" aria-label="Next beat" disabled={last} onClick={() => go(1)}>
            <Icon name="chevron-right" size={22} />
          </button>
        </div>
        <p className="v2-mono is-muted td-prompter-note">Screen stays on. Film with your camera app, then upload the take.</p>
      </footer>
    </div>
  );
}
