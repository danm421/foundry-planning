import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { listFirmMembers } from "@/lib/crm-tasks/members";

export const dynamic = "force-dynamic";

// Roles a book can be attributed to for the admin book-switcher. Matches the
// friendly role strings listFirmMembers derives from Clerk's org role keys.
const ADVISOR_ELIGIBLE_ROLES = new Set(["Admin", "Member"]);

// GET /api/advisors — list the firm's book-owning advisors, for the admin
// book-switcher. Admin/owner only.
export async function GET() {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const members = await listFirmMembers(firmId);
    const advisors = members
      .filter((m) => ADVISOR_ELIGIBLE_ROLES.has(m.role))
      .map((m) => ({ userId: m.userId, displayName: m.displayName }));
    return NextResponse.json({ advisors });
  } catch (err) {
    const e = authErrorResponse(err);
    if (e) return NextResponse.json(e.body, { status: e.status });
    console.error("GET /api/advisors failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
