import { type VercelConfig } from "@vercel/config/v1";

/**
 * Project-level Vercel config. First introduced in billing Phase 3 to wire
 * the daily reconciliation cron. When adding more cron jobs or routing
 * config, extend this file rather than reverting to vercel.json.
 */
export const config: VercelConfig = {
  framework: "nextjs",
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
  ],
};
