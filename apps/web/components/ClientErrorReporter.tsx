"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client-errors";

/** Catches what no error boundary sees: errors in event handlers, timers and promises nobody awaited. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError("error", event.error ?? event.message, { filename: event.filename });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientError("unhandledrejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
