// src/app/api/clients/[id]/risk/rtq/route.ts
//
// POST /api/clients/[id]/risk/rtq -- advisor administers the RTQ in-session,
// for either the primary or the spouse. Same auth preamble as the tolerance
// and environment routes. Unlike the public link route (Task 14), this lands
// directly in `applied` with no token -- nothing is emailed.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/db";
import { riskQuestionnaires } from "@/db/schema";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { RTQ_SUBMIT_SCHEMA } from "@/lib/risk/schema";
import { isCompleteRtq, scoreRtq, RTQ_VERSION } from "@/lib/risk/rtq";
import { applyRtqPatch } from "@/lib/risk/apply-rtq";
import { recomputeProfileTx } from "@/lib/risk/profile";
import { loadExistingScores } from "@/lib/risk/existing-scores";

export const dynamic = "force-dynamic";

// Extend rather than redefine RTQ_SUBMIT_SCHEMA (Task 10) so the public
// route (Task 14) keeps using the bare schema. Mirrors SEND_RTQ_SCHEMA's
// enum spelling exactly.
const ADVISOR_RTQ_SCHEMA = RTQ_SUBMIT_SCHEMA.extend({
  subject: z.enum(["primary", "spouse"]),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = ADVISOR_RTQ_SCHEMA.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { subject, answers, environmentNote } = parsed.data;

    if (!isCompleteRtq(answers)) {
      return NextResponse.json({ error: "Questionnaire incomplete" }, { status: 400 });
    }
    const score = scoreRtq(answers);

    const { userId } = await auth();
    // requireOrgId/requireClientEditAccess have already thrown for an
    // unauthenticated caller by this point -- "system" only covers the
    // theoretical gap between auth() calls, matching recordAudit's own
    // unresolved-actor default (audit.ts).
    const createdByUserId = userId ?? "system";

    // One transaction for the score lookup (which locks the profile row
    // first), the questionnaire insert, and the recompute -- Task 14 ruling
    // 2. A throw after the insert alone would leave an orphaned `applied`
    // row whose score never reached the profile, which a later spouse
    // submission's lookup would then read as legitimate.
    const row = await db.transaction(async (tx) => {
      const { existingPrimaryScore, existingSpouseScore } = await loadExistingScores(tx, {
        clientId,
        firmId,
        subject,
      });

      // The insert must set `subject` explicitly -- the column defaults to
      // "primary", and relying on that default would silently record a
      // spouse sitting as the primary's.
      await tx.insert(riskQuestionnaires).values({
        firmId,
        clientId,
        subject,
        token: null,
        status: "applied",
        rtqVersion: RTQ_VERSION,
        answers,
        score,
        environmentNote: environmentNote ?? null,
        appliedAt: new Date(),
        createdByUserId,
      });

      return recomputeProfileTx(tx, {
        clientId,
        firmId,
        actorUserId: userId ?? null,
        kind: "rtq_completed",
        reason: "Advisor-administered questionnaire",
        patch: {
          ...applyRtqPatch({
            subject,
            score,
            existingPrimaryScore,
            existingSpouseScore,
          }),
          toleranceSource: "rtq_advisor",
        },
      });
    });

    await recordAudit({
      action: "risk_profile.rtq_completed",
      resourceType: "client_risk_profile",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        ...crossFirmAuditMeta({ access }, callerOrg),
        subject,
        score,
      },
    });

    return NextResponse.json({ ok: true, profile: row });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/risk/rtq error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
