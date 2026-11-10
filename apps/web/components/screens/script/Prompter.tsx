"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

import type { ScriptBeat } from "@/lib/cmo/writer/types";

const SHOT_LABEL: Record<ScriptBeat["shot"], string> = { talking_head: "To camera", screen: "Screen", broll: "You film" };

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

  // Taps and swipes are read from pointerup, not click: after a swipe the browser can drop the next tap's click.
  const onDown = (event: PointerEvent) => {
    swipe.current = event.clientX;
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipe.current;
    swipe.current = null;
    if (from === null) return;
    const dx = event.clientX - from;
    if (Math.abs(dx) > 40) {
      go(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) < 10) {
      const box = event.currentTarget.getBoundingClientRect();
      go(event.clientX > box.left + box.width / 2 ? 1 : -1);
    }
  };

  // Prompter.dc.html, filling the phone's screen instead of the artboard's 390 × 844.
  return (
    <div className="k pg-prompter" data-testid="prompter" style={{ minHeight: "100dvh", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: "4px", padding: "12px 8px 8px 16px" }}>
        <div style={{ flex: "1 1 auto", minWidth: "0" }}>
          <div className="meta">Script · {total} s · you film</div>
          <div style={{ fontSize: "15px", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        </div>
        <Link href="/app/studio" className="ib" aria-label="Close the prompter">
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Link>
      </header>

      <div style={{ padding: "0 16px" }}>
        <div className="segs" aria-hidden="true">
          {beats.map((_, i) => (
            <i key={i} data-on={i <= index ? "true" : "false"}></i>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
          <span className="meta mono" aria-live="polite">
            BEAT {index + 1} OF {beats.length}
          </span>
          <span className="meta mono">{beat.seconds} s</span>
        </div>
      </div>

      {/* Taps and swipes on the words are a shortcut for the buttons below, which stay the accessible controls. */}
      <div
        style={{ position: "relative", flex: "1 1 auto", display: "flex", flexDirection: "column", padding: "28px 20px 16px", gap: "16px", minHeight: "0", overflow: "auto", touchAction: "pan-y", cursor: "pointer", userSelect: "none" }}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span className="kind">
            {beat.shot === "screen" ? (
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "15px", height: "15px" }}>
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            ) : (
              <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "15px", height: "15px" }}>
                <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                <rect x="2" y="6" width="14" height="12" rx="2" />
              </svg>
            )}
            {SHOT_LABEL[beat.shot]}
          </span>
        </div>
        <div style={{ fontSize: "15px", color: "var(--muted)" }}>Show: {beat.show}</div>
        <p className="words">{beat.say}</p>
        <div style={{ flex: "1 1 auto" }}></div>
        <div className="meta" style={{ textAlign: "center" }}>
          Tap the right half for the next beat, the left half to go back
        </div>
      </div>

      <div style={{ padding: "12px 16px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid var(--line)", background: "var(--panel)" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button type="button" className="nav" aria-label="Previous beat" onClick={() => go(-1)} disabled={index === 0}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button type="button" className="play" aria-pressed={auto} onClick={() => setAuto((a) => !a)} disabled={last && !auto}>
            {auto ? (
              <>
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                </svg>
                Scrolling at the beat&apos;s pace
              </>
            ) : (
              <>
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
                Auto-scroll
              </>
            )}
          </button>
          <button type="button" className="nav" aria-label="Next beat" onClick={() => go(1)} disabled={last}>
            <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }} className="meta">
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: "13px", height: "13px" }}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
          </svg>
          Screen stays on. Film with your camera app, then upload.
        </div>
      </div>
    </div>
  );
}
