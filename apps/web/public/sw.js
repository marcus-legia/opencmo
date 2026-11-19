/*
 * Ferreto's service worker (P6 C1): web push only. A push carries no payload, so it says nothing by itself: the worker
 * asks the app what to say (same origin, the founder's own session): every autopilot post about to go out, and how
 * many cards wait. A tap opens the queue;
 * nothing is ever decided from a notification. No caching, no offline: the app stays exactly as it is without it.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      // Every autopilot post about to go out, each under its own tag (showing it again does not alert again), and the
      // waiting count beside them: a push carries no payload, so this push may be for any of them (review of #238).
      try {
        const res = await fetch("/api/v1/notify/next", { credentials: "same-origin", cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          const list = json && (json.data ? json.data.autopilot : json.autopilot);
          for (const soon of Array.isArray(list) ? list : []) {
            if (!soon || typeof soon.line !== "string" || typeof soon.approvalId !== "string") continue;
            await self.registration.showNotification("Ferreto", {
              body: soon.line,
              icon: "/icon.svg",
              tag: "autopilot-" + soon.approvalId,
              renotify: false,
              data: { url: "/app/inbox/" + encodeURIComponent(soon.approvalId) },
            });
          }
        }
      } catch (_) {
        // The waiting count below still shows.
      }
      let body = "Cards wait for your decision.";
      try {
        const res = await fetch("/api/v1/account", { credentials: "same-origin", cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          const n = Number((json && (json.data ? json.data.cmo_pending : json.cmo_pending)) || 0);
          if (n === 1) body = "1 card waits for your decision.";
          else if (n > 1) body = n + " cards wait for your decision.";
        }
      } catch (_) {
        // Signed out or offline: the generic line still opens the queue.
      }
      await self.registration.showNotification("Ferreto", { body, icon: "/icon.svg", tag: "opencmo-queue", renotify: true, data: { url: "/app" } });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/app", self.location.origin);
  // Only our own pages.
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // A window already on the queue or that card is reused; any other tab (an open editor mid-edit) is left alone.
      const ours = open.filter((client) => new URL(client.url).origin === url.origin);
      const target = ours.find((client) => new URL(client.url).pathname === url.pathname) || ours.find((client) => new URL(client.url).pathname === "/app");
      if (target && "focus" in target) {
        try {
          const focused = await target.focus();
          // navigate() rejects for a window this worker does not control (opened before it, or after a hard reload).
          if (focused && "navigate" in focused && new URL(focused.url).href !== url.href) await focused.navigate(url.href);
          return;
        } catch {
          // Fall through to a new window.
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
