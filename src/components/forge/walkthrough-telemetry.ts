"use client";
import * as Sentry from "@sentry/nextjs";

/** Lightweight walkthrough lifecycle telemetry. Uses the existing Sentry
 *  breadcrumb trail (the app's only client observability layer) — completion-
 *  rate dashboards are deferred to future-work. Never throws. */
export function logWalkthroughEvent(
  event: "started" | "completed" | "abandoned",
  walkthroughId: string,
  stepIndex?: number,
): void {
  try {
    Sentry.addBreadcrumb({
      category: "walkthrough",
      message: event,
      level: "info",
      data: { walkthroughId, ...(stepIndex != null ? { stepIndex } : {}) },
    });
  } catch {
    /* telemetry must never break a tour */
  }
}
