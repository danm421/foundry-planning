// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://c82970f9dc95e8d33e3ae5e58292c413@o4511269577621504.ingest.us.sentry.io/4511269622972416",

  integrations: [
    // Mask all text and block all media inside session replays —
    // this is a financial-planning app handling client PII.
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  enableLogs: true,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Identity is set explicitly via Clerk in SentryUserContext — never
  // auto-attach IP/cookies/headers.
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
