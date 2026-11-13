"use client";

import { PhotoPostPanel } from "./PhotoPostPanel";
import { useWorkspace } from "./workspace";

/**
 * Slideshows and carousels (D7; owner, 2026-11-13): the founder's own photos and a caption, never a video, on a page of
 * their own. Photos for a text post are added on that post's card instead.
 */
export function PhotosView() {
  // The workspace already holds the connected accounts (the top bar reads them); no calendar to load for a form.
  const ws = useWorkspace();
  return (
    <main style={{ padding: "16px 20px 32px", maxWidth: "880px" }} data-testid="v2-photos">
      <h1 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: "600", letterSpacing: "-0.3px" }}>Slideshows and carousels</h1>
      <p className="meta" style={{ margin: "0 0 14px" }}>
        Your own photos in the order you pick, with a caption: a TikTok photo post, an Instagram carousel or a Threads post. Each
        platform you pick gets its own time to approve on the Calendar.
      </p>
      {ws.ready ? (
        <PhotoPostPanel connectedPlatforms={ws.accounts.map((a) => a.platform)} live />
      ) : (
        <div className="meta">Loading your accounts…</div>
      )}
    </main>
  );
}
