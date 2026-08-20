import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { disabilityPolicies } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { disabilityPolicyCreateSchema } from "@/lib/schemas/disability-policies";
import {
  loadDisabilityPolicies,
  rowToDisabilityPolicy,
} from "@/lib/insurance-policies/load-disability-policies";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

/** decimal columns are strings on the wire; `null` STAYS null. An uncapped
 *  monthly max must never become "0" — that pays nothing, silently. */
const dec = (v: number | null | undefined): string | null =>
  v == null ? null : String(v);

// GET /api/clients/[id]/disability-policies
// Disability policies are client-level (like life insurance), so there is no
// scenario lookup here.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ policies: await loadDisabilityPolicies(id) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/disability-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/disability-policies
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = disabilityPolicyCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const d = parsed.data;

    const [row] = await db
      .insert(disabilityPolicies)
      .values({
        clientId: id,
        name: d.name,
        insured: d.insured,
        carrier: d.carrier ?? null,
        coveredEarningsMode: d.coveredEarningsMode,
        coveredEarningsAmount: dec(d.coveredEarningsAmount),
        hasShortTerm: d.hasShortTerm,
        stdEliminationDays: d.stdEliminationDays,
        stdBenefitPct: String(d.stdBenefitPct),
        stdDurationWeeks: d.stdDurationWeeks,
        stdMonthlyMax: dec(d.stdMonthlyMax),
        hasLongTerm: d.hasLongTerm,
        ltdEliminationDays: d.ltdEliminationDays,
        ltdBenefitPct: String(d.ltdBenefitPct),
        ltdMonthlyMax: dec(d.ltdMonthlyMax),
        ltdBenefitPeriodMode: d.ltdBenefitPeriodMode,
        ltdBenefitPeriodAge: d.ltdBenefitPeriodAge ?? null,
        ltdBenefitPeriodYears: d.ltdBenefitPeriodYears ?? null,
        benefitTaxable: d.benefitTaxable,
        colaRate: String(d.colaRate),
        annualPremium: String(d.annualPremium),
        premiumPayer: d.premiumPayer,
        notes: d.notes ?? null,
      })
      .returning();

    await recordAudit({
      action: "disability_policy.create",
      resourceType: "disability_policy",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: d.name }),
    });

    return NextResponse.json(
      { policy: rowToDisabilityPolicy(row) },
      { status: 201 },
    );
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/disability-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
