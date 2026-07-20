// Batch allocation-decision writes for the draft workbench. Thin wrapper over
// upsertAllocations (src/lib/divorce/divorce-plans.ts); per-item validation
// (splittability, disposition legality) lives in allocation-rules.ts.
//
// Auth preamble copied from src/app/api/clients/[id]/family-members/route.ts
// mutation shape: requireOrgAndUser() + requireClientEditAccess() +
// requireActiveSubscriptionForFirm().
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { formatZodIssues } from "@/lib/schemas/common";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { upsertAllocations, DivorcePlanError } from "@/lib/divorce/divorce-plans";
import { AllocationError } from "@/lib/divorce/allocation-rules";
import { divorceAllocationsPutSchema } from "@/lib/divorce/schemas";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireOrgAndUser();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const { items } = divorceAllocationsPutSchema.parse(body);

    // The workbench's optimistic-PUT reconcile reads only `allocations`, so
    // return just the fresh rows rather than re-deriving the whole workbench.
    const allocations = await upsertAllocations({ clientId: id, firmId, items });
    return NextResponse.json({ allocations });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(err) },
        { status: 422 }
      );
    }
    if (err instanceof AllocationError || err instanceof DivorcePlanError) {
      return NextResponse.json({ error: err.code, code: err.code }, { status: 422 });
    }
    console.error("PUT /api/clients/[id]/divorce-plan/allocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
