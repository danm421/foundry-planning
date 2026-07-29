// src/app/api/clients/[id]/risk/send-rtq/route.ts
//
// POST /api/clients/[id]/risk/send-rtq -- email a client (or their spouse) a
// tokened link to the public RTQ page (Task 14 builds the page the token
// opens). Same auth preamble as the other risk mutation routes. Unlike
// rtq/route.ts this never touches client_risk_profiles -- no score exists
// until the client submits, so there is nothing for recomputeProfile to do
// yet.
import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { riskQuestionnaires } from "@/db/schema";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { SEND_RTQ_SCHEMA } from "@/lib/risk/schema";
import { buildQuestionnaireRow } from "@/lib/risk/send-rtq";
import { OPEN_RTQ_STATUSES } from "@/lib/risk/token-guard";
import { sendRiskQuestionnaireEmail } from "@/lib/risk/email";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";
import { resolveFirmName } from "@/lib/activity/resolve-firm-names";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { client, firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = SEND_RTQ_SCHEMA.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { subject, recipientEmail, recipientName } = parsed.data;

    const { userId } = await auth();
    // requireOrgId/requireClientEditAccess have already thrown for an
    // unauthenticated caller by this point -- "system" only covers the
    // theoretical gap between auth() calls, matching recordAudit's own
    // unresolved-actor default (audit.ts) and the rtq route's precedent.
    const createdByUserId = userId ?? "system";

    const now = new Date();
    const newRow = buildQuestionnaireRow({
      clientId,
      firmId,
      createdByUserId,
      subject,
      recipientEmail,
      recipientName,
      now,
    });

    await db.transaction(async (tx) => {
      // Expire any existing open (draft/sent) link for this subject before
      // writing the new one -- two live tokens for the same person is a
      // support problem, and the most recently sent link should be the one
      // that works. submitted/applied/discarded/expired rows are untouched:
      // expiring a submitted row would destroy a completed client answer the
      // advisor has not yet applied. One transaction with the insert below so
      // a failed insert never leaves the client's previous link expired with
      // no replacement.
      await tx
        .update(riskQuestionnaires)
        .set({ status: "expired" })
        .where(
          and(
            eq(riskQuestionnaires.clientId, clientId),
            eq(riskQuestionnaires.firmId, firmId),
            eq(riskQuestionnaires.subject, subject),
            inArray(riskQuestionnaires.status, OPEN_RTQ_STATUSES),
          ),
        );
      await tx.insert(riskQuestionnaires).values(newRow);
    });

    const link = `${APP_URL}/risk-questionnaire/${newRow.token}`;

    // Email send stays outside the transaction -- never hold a DB
    // transaction open across a network call to a third party.
    const advisor = await currentUser();
    const advisorName =
      [advisor?.firstName, advisor?.lastName].filter(Boolean).join(" ") || undefined;
    const advisorEmail = advisor?.primaryEmailAddress?.emailAddress ?? undefined;
    const firmName = await resolveFirmName(firmId);
    const advisorProfile = await getAdvisorProfile(firmId, client.advisorId);
    const brandFromName = advisorProfile?.brandingEnabled
      ? advisorProfile.emailFromName?.trim() || undefined
      : undefined;
    const brandReplyTo = advisorProfile?.brandingEnabled
      ? advisorProfile.emailReplyTo?.trim() || undefined
      : undefined;

    const { delivered } = await sendRiskQuestionnaireEmail({
      to: recipientEmail,
      link,
      fromName: brandFromName,
      replyTo: brandReplyTo,
      advisorName,
      advisorEmail,
      firmName,
      clientName: recipientName,
    });

    await recordAudit({
      action: "risk_profile.rtq_sent",
      resourceType: "client_risk_profile",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        ...crossFirmAuditMeta({ access }, callerOrg),
        subject,
        recipientEmail,
        delivered,
      },
    });

    return NextResponse.json({ ok: true, link, delivered });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/risk/send-rtq error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
