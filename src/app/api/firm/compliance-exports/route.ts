import { NextResponse, after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireOrgAdminOrOwner, ForbiddenError } from "@/lib/authz";
import { enqueueFirmComplianceExport } from "@/lib/compliance-export/enqueue";
import { hasActiveBatchForFirm, listBatchesForFirm } from "@/lib/compliance-export/batches";
import { drainComplianceExports } from "@/lib/compliance-export/drain";

export const dynamic = "force-dynamic";
// The immediate after() drain renders a chunk before the instance is released.
// Same ceiling/reasoning as the single-client presentations route.
export const maxDuration = 800;

function authError(err: unknown): NextResponse | null {
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function POST(_request: Request): Promise<NextResponse> {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();

    if (await hasActiveBatchForFirm(firmId)) {
      return NextResponse.json(
        { error: "A compliance export is already running for this firm." },
        { status: 409 },
      );
    }

    const { userId } = await auth();
    let email: string | null = null;
    try {
      const u = await currentUser();
      email = u?.emailAddresses?.[0]?.emailAddress ?? null;
    } catch {
      // non-fatal
    }

    const result = await enqueueFirmComplianceExport({
      firmId,
      triggeredBy: userId ?? null,
      triggeredByEmail: email,
      now: new Date(),
    });

    // Responsiveness: start draining immediately; the cron is the safety net.
    after(async () => {
      try {
        await drainComplianceExports();
      } catch (err) {
        console.error("[compliance-exports] immediate drain failed", err);
      }
    });

    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const r = authError(err);
    if (r) return r;
    console.error("POST /api/firm/compliance-exports failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(_request: Request): Promise<NextResponse> {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const batches = await listBatchesForFirm(firmId, 20);
    return NextResponse.json({ batches });
  } catch (err) {
    const r = authError(err);
    if (r) return r;
    console.error("GET /api/firm/compliance-exports failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
