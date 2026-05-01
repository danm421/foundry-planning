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
  ],
};
