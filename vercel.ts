import { type VercelConfig } from "@vercel/config/v1";

/**
 * Project-level Vercel config. First introduced in billing Phase 3 to wire
 * the daily reconciliation cron. When adding more cron jobs or routing
 * config, extend this file rather than reverting to vercel.json.
 */
export const config: VercelConfig = {
  framework: "nextjs",
  // CPU-bound Monte Carlo / solver routes: 3009MB provisions the Performance
  // machine (~2 vCPU vs Standard's 1) — the max Vercel Functions offer. The
  // engine is single-threaded, so the second core's win is concurrency: the
  // PoS gauge and an active solve stop halving each other on a shared vCPU.
  functions: {
    "src/app/api/clients/**/solver/**/route.ts": { memory: 3009 },
    "src/app/api/clients/**/monte-carlo/route.ts": { memory: 3009 },
    "src/app/api/clients/**/life-insurance/solve/route.ts": { memory: 3009 },
    "src/app/api/clients/**/life-insurance/solve-mc/route.ts": { memory: 3009 },
    // Presentation generation (Foundation Plan decks) runs the same
    // solver-grade compute inline: retirement-comparison projection + MC and
    // the LI-summary solve, then a multi-page react-pdf render. Both glob
    // variants are needed: export-pdf is a route.tsx.
    "src/app/api/clients/**/presentations/**/route.ts": { memory: 3009 },
    "src/app/api/clients/**/presentations/**/route.tsx": { memory: 3009 },
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
    {
      path: "/api/cron/orion-sync",
      schedule: "0 7 * * *",
    },
    {
      path: "/api/cron/snapshot-portal-investments",
      schedule: "0 11 * * *",
    },
  ],
};
