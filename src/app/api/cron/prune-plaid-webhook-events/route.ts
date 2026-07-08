// src/app/api/cron/prune-plaid-webhook-events/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { plaidWebhookEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

// Retention window for Plaid webhook delivery logs (PII audit F4). The rows
// are low-sensitivity operational telemetry (type/code/result/timing — never
// a payload, token, or PII), kept long enough to debug delivery issues.
const RETENTION_DAYS = 90;

/**
 * GET /api/cron/prune-plaid-webhook-events — daily Vercel Cron (vercel.ts).
 *
 * Auth: Bearer CRON_SECRET (Vercel Cron injects it). Fail-closed: a missing
 * secret or wrong token gets 401 and never touches data.
 *
 * plaid_webhook_events is intentionally FK-less (rows must survive item
 * unlink for debugging) and has no other deletion path, so this sweep is the
 * sole thing bounding the table — it also covers orphans whose item is gone.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(plaidWebhookEvents)
    .where(lt(plaidWebhookEvents.createdAt, cutoff));

  return NextResponse.json({ deleted: result.rowCount ?? 0, cutoff: cutoff.toISOString() });
}
