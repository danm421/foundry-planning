import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { STAFF_ROLES } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

// GET /api/advisors — list the firm's book-owning advisors, for the admin
// book-switcher. Admin/owner only.
//
// Book ownership is a DENYLIST, not an allowlist: it is the DEFAULT for a firm
// member, and only the book-scoped staff roles are excluded, because their
// visibility is a mapping onto other advisors' books rather than a book of
// their own. This used to allowlist the friendly strings ["Admin", "Member"],
// which silently dropped anyone holding a CUSTOM Clerk role — a firm that
// invited its advisors under an "Advisor" role got a book-switcher that could
// not see them at all, with nothing to explain it. Gate on the raw role key,
// never on the display string.
export async function GET() {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const members = await listFirmMembers(firmId);
    const advisors = members
      .filter((m) => !STAFF_ROLES.has(m.roleKey))
      .map((m) => ({ userId: m.userId, displayName: m.displayName }));
    return NextResponse.json({ advisors });
  } catch (err) {
    const e = authErrorResponse(err);
    if (e) return NextResponse.json(e.body, { status: e.status });
    console.error("GET /api/advisors failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
