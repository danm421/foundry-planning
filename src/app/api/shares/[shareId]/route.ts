import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { revokeShare } from "@/lib/clients/share-manage";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/shares/[shareId]
 * Revoke an active share. Caller must be the share owner or an org:admin of
 * the owning firm. Auth enforced inside revokeShare.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  try {
    const [{ orgId, userId }, { orgRole }] = await Promise.all([
      requireOrgAndUser(),
      auth(),
    ]);

    const { shareId } = await params;
    await revokeShare(shareId, { userId, orgId, orgRole });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    console.error("DELETE /api/shares/[shareId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
