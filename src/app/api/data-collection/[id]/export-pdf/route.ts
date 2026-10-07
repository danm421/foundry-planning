// src/app/api/data-collection/[id]/export-pdf/route.ts
//
// The client's answers to a submitted data-collection form, as a PDF in the
// presentation deck's style. Download only — nothing is filed anywhere.
import { NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { loadFormForCaller } from "@/lib/intake/form-access";
import { listIntakeDocuments } from "@/lib/intake/documents";
import { intakeSubmitSchemaFor } from "@/lib/intake/schema";
import { sectionsForForm } from "@/lib/intake/sections";
import { buildIntakeAnswersDocument } from "@/lib/intake/answers-document";
import { resolveBranding } from "@/lib/branding/branding";
import { foundryDefaultLogoDataUrl } from "@/lib/presentations/default-logo";
import { recordAudit } from "@/lib/audit";
import { slugForFilename } from "@/lib/filename-slug";
import { IntakeAnswersPdfDocument } from "@/components/intake-answers-pdf/intake-answers-pdf-document";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { orgId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(orgId);
    const { id } = await ctx.params;

    const rl = await checkExportPdfRateLimit(orgId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many PDF exports. Please wait a moment and try again.");
    }

    const form = await loadFormForCaller(id, orgId);
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // `submittedAt`, not a status list — the same predicate the review page
    // uses, and a draft's half-typed payload can never satisfy the parse below.
    if (form.submittedAt === null) {
      return NextResponse.json({ error: "This form hasn't been submitted yet." }, { status: 409 });
    }

    const sections = sectionsForForm(form.sections);
    const parsed = intakeSubmitSchemaFor(sections).safeParse(form.payload);
    if (!parsed.success) {
      return NextResponse.json({ error: "This form's answers can't be read." }, { status: 422 });
    }

    // Firm branding, not the advisor's: it is what the client saw on the form.
    const [documents, branding, foundryLogo] = await Promise.all([
      listIntakeDocuments(form.id, { wholeHousehold: true }),
      resolveBranding(orgId),
      foundryDefaultLogoDataUrl().catch(() => null),
    ]);

    const doc = buildIntakeAnswersDocument({
      payload: parsed.data,
      sections,
      documents,
      recipientName: form.recipientName,
      recipientEmail: form.recipientEmail,
      sentAt: form.sentAt,
      submittedAt: form.submittedAt,
      // A blank start year meant "from now" when the client said it — anchor
      // spans to the submission, not to whichever year the PDF is pulled.
      currentYear: form.submittedAt.getUTCFullYear(),
    });

    const element = React.createElement(IntakeAnswersPdfDocument, {
      doc,
      firmName: branding.firmName,
      logoDataUrl: branding.logoDataUrl ?? foundryLogo,
      accentColor: branding.primaryColor,
    }) as React.ReactElement<DocumentProps>;

    const buffer = await Promise.race<Buffer>([
      renderToBuffer(element),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    await recordAudit({
      action: "intake.form.export_pdf",
      resourceType: "intake_form",
      resourceId: form.id,
      clientId: form.clientId ?? null,
      firmId: orgId,
    });

    const filename = `data-collection-${slugForFilename(doc.householdName)}-${form.submittedAt
      .toISOString()
      .slice(0, 10)}.pdf`;
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    console.error("[data-collection export-pdf]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
