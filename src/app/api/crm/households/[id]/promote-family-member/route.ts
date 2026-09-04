import { NextRequest, NextResponse } from "next/server";
import { promoteFamilyMember, FamilyMemberNotInHouseholdError } from "@/lib/crm/promote-family-member";
import { promoteFamilyMemberSchema } from "@/lib/crm/schemas";
import { UnauthorizedError } from "@/lib/db-helpers";
import { authErrorResponse, requireActiveSubscription } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireActiveSubscription();
    const body = await req.json();
    const parsed = promoteFamilyMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const result = await promoteFamilyMember(id, parsed.data);
    return NextResponse.json(result, { status: result.existing ? 200 : 201 });
  } catch (err) {
    const denial = authErrorResponse(err);
    if (denial) return NextResponse.json(denial.body, { status: denial.status });
    if (err instanceof FamilyMemberNotInHouseholdError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message.startsWith("CRM household not found or access denied")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("POST /api/crm/households/[id]/promote-family-member error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
