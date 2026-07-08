import { type NextRequest, NextResponse } from "next/server";
import { drainComplianceExports } from "@/lib/compliance-export/drain";

export const dynamic = "force-dynamic";
// Renders a chunk of client PDFs per invocation; must exceed one chunk's render
// time and stay under STALE_RUN_MS (see generation-runs.ts).
export const maxDuration = 800;

/** GET /api/cron/drain-compliance-exports — every-minute Vercel Cron (vercel.ts). */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get("authorization");
  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await drainComplianceExports();
  return NextResponse.json({ ok: true, ...result });
}
