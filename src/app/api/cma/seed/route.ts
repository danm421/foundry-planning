import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { seedCmaForFirm } from "@/lib/cma-seed-runner";

export const dynamic = "force-dynamic";

// POST /api/cma/seed — manually (re)seed default CMAs for the caller's firm.
// Idempotent; see seedCmaForFirm() for the guarantees.
//
// Doubles as Layer 3 (the lazy fallback called by the /cma page on mount).
// When this path actually inserts rows (result.inserted.* > 0), it means
// the eager webhook and/or inline signup path failed — log a warning so
// the team can investigate.
export async function POST() {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();

    const result = await seedCmaForFirm(firmId);

    const didInsert =
      result.inserted.assetClasses > 0 ||
      result.inserted.portfolios > 0 ||
      result.inserted.allocations > 0 ||
      result.inserted.correlations > 0;

    if (didInsert) {
      console.warn(
        `[cma.seed] lazy path inserted rows for firm ${firmId} — ` +
          `upstream eager-seed layers may have failed. inserted=${JSON.stringify(
            result.inserted
          )}`
      );
    }

    await recordAudit({
      action: "cma.seed",
      resourceType: "cma",
      resourceId: firmId,
      firmId,
      metadata: result,
    });

    return NextResponse.json(
      { seeded: true, ...result },
      { status: 201 }
    );
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp)
      return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/cma/seed error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
