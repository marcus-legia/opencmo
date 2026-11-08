"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { reportClientError } from "@/lib/client-errors";

/** Public pages (landing, blog, login). `/app` has its own boundary, which keeps the rail alive. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("boundary", error, { source: "app/error", digest: error.digest });
    Sentry.captureException(error);
  }, [error]);

  return (
    <section className="empty-state">
      <p>Something went wrong on this page.</p>
      <button type="button" className="primary-button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
