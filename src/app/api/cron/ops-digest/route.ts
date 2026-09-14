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
// NOTHING to report means NO email — no attention rows AND no live trial or
// recent cancellation. A daily "nothing happened" message is how a sender gets
// filtered. Note the standing trials roster keeps the mail flowing while any
// trial is running, which is the point: a trial is money in play every day.
// The active-people roster deliberately does NOT get that power — see the
// comment beside `who` in digest.ts.
import { type NextRequest, NextResponse } from "next/server";
import { loadGrowthInput } from "@/lib/ops/growth/load";
import { buildAttention } from "@/lib/ops/growth/attention";
import { buildAccountRows } from "@/lib/ops/growth/accounts";
import { buildActivePeople } from "@/lib/ops/growth/active-people";
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

  // Strip any trailing slash, exactly as notification-digest does: without it
  // a trailing slash in the env var yields "…//admin/growth" in the email.
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.foundryplanning.com").replace(
    /\/+$/,
    "",
  );
  const input = await loadGrowthInput();
  const rows = buildAttention(input);
  const accounts = buildAccountRows(input);
  const people = buildActivePeople(input);
  const mail = buildDigest({ rows, accounts, people, dashboardUrl: `${base}/admin/growth` });

  // Every count is reported as measured in both branches — a hard-coded 0 on
  // the quiet path would hide the case where buildDigest declined rows it was
  // actually handed. `people` never keeps the mail alive, so a quiet run that
  // reports people > 0 is correct, not a bug.
  const counted = { rows: rows.length, accounts: accounts.length, people: people.length };
  if (!mail) return NextResponse.json({ ...counted, sent: false, reason: "quiet" });

  const { delivered } = await sendOpsDigest(mail);
  return NextResponse.json({ ...counted, sent: delivered });
}
