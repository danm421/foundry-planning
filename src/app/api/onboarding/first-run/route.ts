import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  markFirstRunStarted,
  dismissFirstRun,
  dismissWelcomeVideo,
} from "@/lib/onboarding/advisor-first-run";

const ACTIONS = {
  start: { run: markFirstRunStarted, audit: "advisor_onboarding.start" },
  dismiss: { run: dismissFirstRun, audit: "advisor_onboarding.dismiss" },
  dismiss_welcome_video: {
    run: dismissWelcomeVideo,
    audit: "advisor_onboarding.welcome_video_dismiss",
  },
} as const;

// PATCH /api/onboarding/first-run
// Advances or dismisses the caller's own first-run onboarding card, or
// records Home's welcome video as seen. There is no id in the request body to
// validate: `requireOrgAndUser()`'s `{ orgId, userId }` IS the scope — an
// advisor can only ever touch their own (firmId, advisorUserId) row.
export async function PATCH(req: Request) {
  try {
    const { orgId, userId } = await requireOrgAndUser();
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    const action =
      body.action && Object.hasOwn(ACTIONS, body.action)
        ? ACTIONS[body.action as keyof typeof ACTIONS]
        : null;
    if (!action) {
      return NextResponse.json(
        { error: `action must be one of: ${Object.keys(ACTIONS).join(", ")}` },
        { status: 400 },
      );
    }

    await action.run(orgId, userId);

    await recordAudit({
      action: action.audit,
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
