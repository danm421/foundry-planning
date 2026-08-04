import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  markFirstRunStarted,
  dismissFirstRun,
} from "@/lib/onboarding/advisor-first-run";

// PATCH /api/onboarding/first-run
// Advances or dismisses the caller's own first-run onboarding card. There is
// no id in the request body to validate: `requireOrgAndUser()`'s
// `{ orgId, userId }` IS the scope — an advisor can only ever touch their
// own (firmId, advisorUserId) row.
export async function PATCH(req: Request) {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action !== "start" && body.action !== "dismiss") {
      return NextResponse.json(
        { error: 'action must be "start" or "dismiss"' },
        { status: 400 },
      );
    }

    if (body.action === "start") {
      await markFirstRunStarted(orgId, userId);
    } else {
      await dismissFirstRun(orgId, userId);
    }

    await recordAudit({
      action:
        body.action === "start"
          ? "advisor_onboarding.start"
          : "advisor_onboarding.dismiss",
      resourceType: "advisor_onboarding",
      resourceId: userId,
      firmId: orgId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/onboarding/first-run error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
