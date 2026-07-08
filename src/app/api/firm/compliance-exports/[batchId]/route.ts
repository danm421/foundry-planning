import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import {
  getBatchForFirm,
  childStatusCounts,
  type SkippedClient,
} from "@/lib/compliance-export/batches";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<NextResponse> {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { batchId } = await params;

    const batch = await getBatchForFirm(batchId, firmId);
    if (!batch) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const c = await childStatusCounts(batchId);
    const skippedClients = (batch.skippedClients as SkippedClient[] | null) ?? [];

    return NextResponse.json({
      id: batch.id,
      status: batch.status,
      totalClients: batch.totalClients,
      done: c.done,
      failed: c.failed,
      remaining: c.queued + c.running + c.analyzing,
      skippedCount: skippedClients.length,
      skippedClients,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      createdAt: batch.createdAt,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/firm/compliance-exports/[batchId] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
