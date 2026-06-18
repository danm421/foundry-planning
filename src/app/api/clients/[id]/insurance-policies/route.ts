import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  scenarios,
  accounts,
  accountOwners,
  familyMembers,
  lifeInsurancePolicies,
  lifeInsuranceCashValueSchedule,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { insurancePolicyCreateSchema } from "@/lib/schemas/insurance-policies";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";
import {
  ownerRefToAccountOwnerRows,
  type OwnerRef,
} from "@/lib/insurance-policies/owner-ref";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// Zod `policyType` uses short names; the accounts.subType enum uses
// the longer canonical forms. Mapping is 1:1 but explicit so a future
// enum addition surfaces as a TS error instead of a silent fallthrough.
function mapPolicyTypeToSubType(
  t: "term" | "whole" | "universal" | "variable",
): "term" | "whole_life" | "universal_life" | "variable_life" {
  switch (t) {
    case "term":
      return "term";
    case "whole":
      return "whole_life";
    case "universal":
      return "universal_life";
    case "variable":
      return "variable_life";
  }
}

// GET /api/clients/[id]/insurance-policies
// Lists all life-insurance policies for the client's base-case scenario
// as `{ account, policy }` pairs. Filters by category in SQL so we don't
// ship unrelated account rows back to the client.
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

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const accountRows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.scenarioId, scenarioId),
          eq(accounts.category, "life_insurance"),
        ),
      );

    const policyMap = await loadPoliciesByAccountIds(accountRows.map((a) => a.id));

    const shaped = accountRows.map((account) => ({
      account,
      policy: policyMap[account.id] ?? null,
    }));

    return NextResponse.json({ policies: shaped });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/insurance-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/insurance-policies
// Creates a life-insurance account + policy + (optional) free-form
// cash-value schedule in a single transaction so a partial write can't
// leave a policy orphaned from its account.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = insurancePolicyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const input = parsed.data;

    // Look up FM ids so we can synthesize account_owners rows.
    const fmRows = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id));
    const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
    const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

    const policyAccountId = await db.transaction(async (tx) => {
      const [acct] = await tx
        .insert(accounts)
        .values({
          clientId: id,
          scenarioId,
          name: input.name,
          category: "life_insurance",
          subType: mapPolicyTypeToSubType(input.policyType),
          insuredPerson: input.insuredPerson,
          value: String(input.cashValue),
          // `accounts.basis` is unused for life-insurance — the policy's
          // cost basis is tracked on the life_insurance_policies row.
          basis: "0",
        })
        .returning({ id: accounts.id, name: accounts.name });

      // Insert account_owners rows via the OwnerRef translation helper —
      // the single source of truth shared with PATCH. `joint` produces two
      // family rows at 0.5 each; everything else is one row at 1.0.
      const ownerRows = ownerRefToAccountOwnerRows(
        input.ownerRef as OwnerRef,
        { clientFmId, spouseFmId },
      );
      if (ownerRows.length > 0) {
        await tx.insert(accountOwners).values(
          ownerRows.map((r) => ({
            accountId: acct.id,
            familyMemberId: r.familyMemberId,
            entityId: r.entityId,
            externalBeneficiaryId: r.externalBeneficiaryId,
            percent: r.percent,
          })),
        );
      }

      await tx.insert(lifeInsurancePolicies).values({
        accountId: acct.id,
        faceValue: String(input.faceValue),
        costBasis: String(input.costBasis),
        premiumAmount: String(input.premiumAmount),
        premiumYears: input.premiumYears ?? null,
        premiumPayer: input.premiumPayer,
        policyType: input.policyType,
        termIssueYear: input.termIssueYear ?? null,
        termLengthYears: input.termLengthYears ?? null,
        endsAtInsuredRetirement: input.endsAtInsuredRetirement,
        cashValueGrowthMode: input.cashValueGrowthMode,
        premiumScheduleMode: input.premiumScheduleMode,
        deathBenefitScheduleMode: input.deathBenefitScheduleMode,
        incomeScheduleMode: input.incomeScheduleMode,
        postPayoutGrowthRate: String(input.postPayoutGrowthRate),
        postPayoutModelPortfolioId: input.postPayoutModelPortfolioId ?? null,
      });

      if (input.cashValueSchedule.length > 0) {
        await tx.insert(lifeInsuranceCashValueSchedule).values(
          input.cashValueSchedule.map((r) => ({
            policyId: acct.id,
            year: r.year,
            cashValue: r.cashValue != null ? String(r.cashValue) : null,
            premiumAmount: r.premiumAmount != null ? String(r.premiumAmount) : null,
            income: r.income != null ? String(r.income) : null,
            deathBenefit: r.deathBenefit != null ? String(r.deathBenefit) : null,
          })),
        );
      }

      return acct.id;
    });

    await recordAudit({
      action: "insurance_policy.create",
      resourceType: "insurance_policy",
      resourceId: policyAccountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: input.name, policyType: input.policyType }),
    });

    return NextResponse.json({ id: policyAccountId }, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/insurance-policies error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
