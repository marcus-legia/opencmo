"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client-errors";

/** The root layout itself failed, so this replaces it: its own document, and none of its stylesheets or reporter. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("global-boundary", error, { source: "app/global-error", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <p>Something went wrong.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </body>
    </html>
  );
}
