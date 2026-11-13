"use client";

import { useScreen } from "@/components/screens/useScreen";

import { PhotoPostPanel } from "./PhotoPostPanel";

/**
 * Slideshows and carousels (D7; owner, 2026-11-13): the founder's own photos and a caption, never a video, on a page of
 * their own. Photos for a text post are added on that post's card instead.
 */
export function PhotosView() {
  // The schedule screen carries the connected accounts and whether this is the founder's live data or a sample.
  const [state, reload] = useScreen("schedule");
  const data = state.status === "ready" ? state.data : null;
  return (
    <main style={{ padding: "16px 20px 32px", maxWidth: "880px" }} data-testid="v2-photos">
      <h1 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: "600", letterSpacing: "-0.3px" }}>Slideshows and carousels</h1>
      <p className="meta" style={{ margin: "0 0 14px" }}>
        Your own photos in the order you pick, with a caption: a TikTok photo post, an Instagram carousel or a Threads post. Each
        platform you pick gets its own time to approve on the Calendar.
      </p>
      {state.status === "error" ? <div className="meta">{state.message}</div> : null}
      {state.status === "loading" ? <div className="meta">Loading your accounts…</div> : null}
      {data ? <PhotoPostPanel accounts={data.accounts} live={state.status === "ready" && state.live.postingPlan} onScheduled={reload} /> : null}
    </main>
  );
}
