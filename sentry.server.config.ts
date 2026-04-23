// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://c82970f9dc95e8d33e3ae5e58292c413@o4511269577621504.ingest.us.sentry.io/4511269622972416",

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  enableLogs: true,

  // Financial-planning app: never auto-attach IP/cookies/headers. User
  // identity is set explicitly from Clerk in SentryUserContext.
  sendDefaultPii: false,
});
