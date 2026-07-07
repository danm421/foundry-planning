// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://c82970f9dc95e8d33e3ae5e58292c413@o4511269577621504.ingest.us.sentry.io/4511269622972416",

  // Session Replay is the heaviest part of the SDK (~45KB gzipped). Rather than
  // static-bundle `replayIntegration` here (which lands it in the initial
  // client chunk on every page), it's loaded from Sentry's CDN right after init
  // (see below) so it's tree-shaken out of first paint. Keep this array empty.
  integrations: [],

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  enableLogs: true,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Identity is set explicitly via Clerk in SentryUserContext — never
  // auto-attach IP/cookies/headers.
  sendDefaultPii: false,
});

// Load Session Replay from the CDN after init instead of bundling it. This is
// still added on every session (buffering mode) so `replaysOnErrorSampleRate`
// keeps capturing pre-error frames for un-sampled sessions — it defers the
// recorder off the initial bundle, it does NOT gate it on the sample rate.
// `lazyLoadIntegration` injects a <script src="https://browser.sentry-cdn.com/
// <version>/replay.min.js"> (allowlisted in next.config.ts script-src); replay
// then tunnels/ingests through the already-allowed Sentry origins. Masking is
// preserved (financial-planning PII). Best-effort: a CDN failure must never
// break the app, so swallow the error.
async function loadSessionReplay(): Promise<void> {
  try {
    const replayIntegration = await Sentry.lazyLoadIntegration("replayIntegration");
    Sentry.addIntegration(replayIntegration({ maskAllText: true, blockAllMedia: true }));
  } catch {
    // Replay is best-effort telemetry; ignore load failures.
  }
}

void loadSessionReplay();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
