import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { setAdvisorBrandingEnabled } from "@/lib/branding/advisor-profile";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const enabledSchema = z.object({ enabled: z.boolean() }).strict();

// PATCH /api/advisor-branding/[advisorUserId]/enabled — admin-only. Flips the
// per-advisor branding grant on or off; does not touch the brand fields
// themselves.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ advisorUserId: string }> },
): Promise<Response> {
  try {
    await requireOrgAdminOrOwner();
    const { orgId, userId } = await requireOrgAndUser();
    const { advisorUserId } = await params;

    const body = await req.json().catch(() => ({}));
    const parsed = enabledSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await setAdvisorBrandingEnabled(orgId, advisorUserId, parsed.data.enabled, userId);

    await recordAudit({
      action: "advisor_branding.grant",
      resourceType: "advisor_profile",
      resourceId: advisorUserId,
      firmId: orgId,
      // Same action name covers both directions of this toggle — without
      // this, the row can't tell a grant from a revoke.
      metadata: { enabled: parsed.data.enabled },
    });

    return NextResponse.json({ ok: true, advisorUserId, enabled: parsed.data.enabled });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/advisor-branding/[advisorUserId]/enabled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
