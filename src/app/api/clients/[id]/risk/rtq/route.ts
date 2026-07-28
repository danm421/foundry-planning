// src/app/api/clients/[id]/risk/rtq/route.ts
//
// POST /api/clients/[id]/risk/rtq -- advisor administers the RTQ in-session,
// for either the primary or the spouse. Same auth preamble as the tolerance
// and environment routes. Unlike the (future) public link route, this lands
// directly in `applied` with no token -- nothing is emailed.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientRiskProfiles, riskQuestionnaires } from "@/db/schema";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { RTQ_SUBMIT_SCHEMA } from "@/lib/risk/schema";
import { isCompleteRtq, scoreRtq, RTQ_VERSION } from "@/lib/risk/rtq";
import { applyRtqPatch } from "@/lib/risk/apply-rtq";
import { recomputeProfile } from "@/lib/risk/profile";

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

    const [profile] = await db
      .select({
        toleranceScore: clientRiskProfiles.toleranceScore,
        spouseToleranceScore: clientRiskProfiles.spouseToleranceScore,
      })
      .from(clientRiskProfiles)
      .where(
        and(eq(clientRiskProfiles.clientId, clientId), eq(clientRiskProfiles.firmId, firmId)),
      );

    // client_risk_profiles.spouse_tolerance_score is always the spouse's own
    // raw score (applyRtqPatch never reconciles it), so it is safe to read
    // straight off the profile row for the primary-submission path.
    const existingSpouseScore: number | null = profile?.spouseToleranceScore ?? null;
    let existingPrimaryScore: number | null = null;

    if (subject === "spouse") {
      const [lastPrimary] = await db
        .select({ score: riskQuestionnaires.score })
        .from(riskQuestionnaires)
        .where(
          and(
            eq(riskQuestionnaires.clientId, clientId),
            eq(riskQuestionnaires.firmId, firmId),
            eq(riskQuestionnaires.subject, "primary"),
            eq(riskQuestionnaires.status, "applied"),
          ),
        )
        .orderBy(desc(riskQuestionnaires.appliedAt))
        .limit(1);
      // KNOWN LIMITATION (Task 11, controller finding F, awaiting ruling): when no
      // applied `primary` questionnaire exists, this falls back to the profile's
      // tolerance_score, which is already the reconciled minimum once a spouse score
      // is present. Repeated spouse sittings on a backfilled household can then only
      // ratchet tolerance down. A narrow guard (fall back only when
      // spouseToleranceScore is null) would fix it; do not add it without the ruling.
      existingPrimaryScore = lastPrimary?.score ?? profile?.toleranceScore ?? null;
    }

    // The insert must set `subject` explicitly -- the column defaults to
    // "primary", and relying on that default would silently record a spouse
    // sitting as the primary's.
    await db.insert(riskQuestionnaires).values({
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

    const row = await recomputeProfile({
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
