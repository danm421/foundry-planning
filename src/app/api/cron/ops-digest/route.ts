// src/app/api/cron/ops-digest/route.ts
//
// GET /api/cron/ops-digest -- daily Vercel Cron (vercel.ts, 0 12 * * *).
//
// Auth: Bearer CRON_SECRET. Reads the same data the /admin/growth page reads,
// through the same builders, so the email and the page cannot disagree.
//
// 0 12 * * * is 7:00am EST. Vercel crons do not observe DST, so it is 8:00am
// EDT for the ~8 months the US is on daylight time — the same fixed-UTC
// tradeoff notification-digest documents.
//
// ZERO attention rows means NO email. A daily "nothing happened" message is
// how a sender gets filtered.
import { type NextRequest, NextResponse } from "next/server";
import { loadGrowthInput } from "@/lib/ops/growth/load";
import { buildAttention } from "@/lib/ops/growth/attention";
import { buildDigest } from "@/lib/ops/growth/digest";
import { sendOpsDigest } from "@/lib/ops/growth/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || "https://app.foundryplanning.com";
  const input = await loadGrowthInput();
  const rows = buildAttention(input);
  const mail = buildDigest(rows, `${base}/admin/growth`);

  if (!mail) return NextResponse.json({ rows: 0, sent: false, reason: "quiet" });

  const { delivered } = await sendOpsDigest(mail);
  return NextResponse.json({ rows: rows.length, sent: delivered });
}
