import { type VercelConfig } from "@vercel/config/v1";

/**
 * Project-level Vercel config. First introduced in billing Phase 3 to wire
 * the daily reconciliation cron. When adding more cron jobs or routing
 * config, extend this file rather than reverting to vercel.json.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  // Every route handler runs on the Performance machine (3009MB, ~2 vCPU —
  // the max Vercel Functions offer; Standard's 2048MB is 1 vCPU). Originally
  // scoped to the CPU-bound solver/MC routes, but the scoping itself became
  // the bug: presentation generation runs solver-grade compute (projection +
  // MC + LI solve) and was left on the small machine, so prod decks crawled
  // and died. App-wide costs ~2¢/month more at current volume (memory-time is
  // pennies; active-CPU billing is unaffected by machine size) and removes
  // the "forgot to scope a heavy route" failure mode for good.
  functions: {
    "src/app/**/route.ts": { memory: 3009 },
    "src/app/**/route.tsx": { memory: 3009 },
    "src/app/**/page.tsx": { memory: 3009 },
  },
  crons: [
    {
      path: "/api/cron/reconcile-billing",
      schedule: "0 5 * * *",
    },
    {
      path: "/api/cron/refresh-holding-prices",
      schedule: "0 9 * * *",
    },
    {
      path: "/api/cron/purge-deleted-households",
      schedule: "0 4 * * *",
    },
    {
      path: "/api/cron/purge-expired-firms",
      schedule: "0 6 * * *",
    },
    {
      path: "/api/cron/refresh-ticker-portfolios",
      schedule: "0 10 1 * *",
    },
    // Monthly, two hours after the ticker-portfolio refresh. Covers the
    // securities clients actually HOLD, which that job does not walk.
    {
      path: "/api/cron/refresh-security-price-history",
      schedule: "0 12 1 * *",
    },
    {
      path: "/api/cron/integration-sync",
      schedule: "0 7 * * *",
    },
    {
      path: "/api/cron/snapshot-portal-investments",
      schedule: "0 11 * * *",
    },
    {
      // Every 15 min, NOT every minute. Neon's Launch plan scales a compute to
      // zero after 5 minutes idle and that timeout is not configurable lower,
      // so a once-a-minute hit meant the production database never suspended —
      // it ran continuously from Aug 19 to Sep 1, and idle compute was 88% of
      // the Neon bill. This drain is a firm-wide bulk job (a deck per
      // household, 4 rendered per pass under an 8-minute budget) that nobody
      // waits on interactively, so a start delay of up to 15 minutes is free.
      // 15 also matches STALE_RUN_MS, so the orphan sweep in drain.ts still
      // observes a stuck run within one cycle of it going stale.
      path: "/api/cron/drain-compliance-exports",
      schedule: "*/15 * * * *",
    },
    {
      path: "/api/cron/prune-plaid-webhook-events",
      schedule: "0 8 * * *",
    },
    {
      path: "/api/cron/refresh-risk-capacity",
      schedule: "0 6 * * *",
    },
    {
      path: "/api/cron/notification-scan",
      schedule: "0 8 * * *",
    },
    {
      path: "/api/cron/notification-digest",
      schedule: "0 9 * * *",
    },
  ],
};
