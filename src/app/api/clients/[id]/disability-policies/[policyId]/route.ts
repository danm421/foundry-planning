import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { disabilityPolicies, type NewDisabilityPolicyRow } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { disabilityPolicyUpdateSchema } from "@/lib/schemas/disability-policies";
import { rowToDisabilityPolicy } from "@/lib/insurance-policies/load-disability-policies";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

/** decimal columns are strings on the wire; `null` STAYS null. An uncapped
 *  monthly max must never become "0" — that pays nothing, silently. */
const dec = (v: number | null | undefined): string | null =>
  v == null ? null : String(v);

// PATCH /api/clients/[id]/disability-policies/[policyId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = disabilityPolicyUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // Build the patch from ONLY the keys the body actually carried. Never
    // `.set(parsed.data)` — that is the mass-assignment shape flagged across
    // this repo, and `strictPartial` is what keeps an absent key absent.
    const patch: Partial<NewDisabilityPolicyRow> = {};
    if (d.name !== undefined) patch.name = d.name;
    if (d.insured !== undefined) patch.insured = d.insured;
    if (d.carrier !== undefined) patch.carrier = d.carrier ?? null;
    if (d.coveredEarningsMode !== undefined) {
      patch.coveredEarningsMode = d.coveredEarningsMode;
    }
    if (d.coveredEarningsAmount !== undefined) {
      patch.coveredEarningsAmount = dec(d.coveredEarningsAmount);
    }
    if (d.hasShortTerm !== undefined) patch.hasShortTerm = d.hasShortTerm;
    if (d.stdEliminationDays !== undefined) {
      patch.stdEliminationDays = d.stdEliminationDays;
    }
    if (d.stdBenefitPct !== undefined) {
      patch.stdBenefitPct = String(d.stdBenefitPct);
    }
    if (d.stdDurationWeeks !== undefined) {
      patch.stdDurationWeeks = d.stdDurationWeeks;
    }
    if (d.stdMonthlyMax !== undefined) patch.stdMonthlyMax = dec(d.stdMonthlyMax);
    if (d.hasLongTerm !== undefined) patch.hasLongTerm = d.hasLongTerm;
    if (d.ltdEliminationDays !== undefined) {
      patch.ltdEliminationDays = d.ltdEliminationDays;
    }
    if (d.ltdBenefitPct !== undefined) {
      patch.ltdBenefitPct = String(d.ltdBenefitPct);
    }
    if (d.ltdMonthlyMax !== undefined) patch.ltdMonthlyMax = dec(d.ltdMonthlyMax);
    if (d.ltdBenefitPeriodMode !== undefined) {
      patch.ltdBenefitPeriodMode = d.ltdBenefitPeriodMode;
    }
    if (d.ltdBenefitPeriodAge !== undefined) {
      patch.ltdBenefitPeriodAge = d.ltdBenefitPeriodAge ?? null;
    }
    if (d.ltdBenefitPeriodYears !== undefined) {
      patch.ltdBenefitPeriodYears = d.ltdBenefitPeriodYears ?? null;
    }
    if (d.benefitTaxable !== undefined) patch.benefitTaxable = d.benefitTaxable;
    if (d.colaRate !== undefined) patch.colaRate = String(d.colaRate);
    if (d.annualPremium !== undefined) {
      patch.annualPremium = String(d.annualPremium);
    }
    if (d.premiumPayer !== undefined) patch.premiumPayer = d.premiumPayer;
    if (d.notes !== undefined) patch.notes = d.notes ?? null;
    patch.updatedAt = new Date();

    // Tenant-isolation lives INSIDE the query: a policy id belonging to
    // another client matches nothing, so `.returning()` is empty and the
    // caller gets a 404 rather than a row they should never see.
    const [row] = await db
      .update(disabilityPolicies)
      .set(patch)
      .where(
        and(
          eq(disabilityPolicies.id, policyId),
          eq(disabilityPolicies.clientId, id),
        ),
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await recordAudit({
      action: "disability_policy.update",
      resourceType: "disability_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        name: row.name,
        fieldsChanged: Object.keys(d),
      }),
    });

    return NextResponse.json({ policy: rowToDisabilityPolicy(row) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PATCH /api/clients/[id]/disability-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/disability-policies/[policyId]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // Same in-query scoping as PATCH — an empty `.returning()` is a 404.
    const [row] = await db
      .delete(disabilityPolicies)
      .where(
        and(
          eq(disabilityPolicies.id, policyId),
          eq(disabilityPolicies.clientId, id),
        ),
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await recordAudit({
      action: "disability_policy.delete",
      resourceType: "disability_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: row.name }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/disability-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
