import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  familyMembers,
  lifeInsurancePolicies,
  lifeInsuranceCashValueSchedule,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { insurancePolicyUpdateSchema } from "@/lib/schemas/insurance-policies";
import {
  ownerRefToAccountOwnerRows,
  type OwnerRef,
} from "@/lib/insurance-policies/owner-ref";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// Zod `policyType` uses short names; the accounts.subType enum uses
// the longer canonical forms. Duplicated here (rather than imported
// from the list route) because the sibling file doesn't export it —
// refactoring that would sprawl beyond this task's scope.
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

// PATCH /api/clients/[id]/insurance-policies/[policyId] — partial update
// of a life-insurance policy (the underlying account + policy row +
// optional full replacement of the free-form cash-value schedule).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // Tenant-isolation: confirm the target account exists, belongs to this
    // client, and is a life-insurance account. Without this, an attacker
    // with any known account UUID could mutate or delete unrelated rows
    // through this endpoint.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, policyId),
          eq(accounts.clientId, id),
          eq(accounts.category, "life_insurance"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = insurancePolicyUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    // The update schema's inferred type is loose (see schema's
    // Object.fromEntries cast) — narrow it here so field accesses are typed.
    const input = parsed.data as Partial<{
      name: string;
      policyType: "term" | "whole" | "universal" | "variable";
      insuredPerson: "client" | "spouse" | "joint";
      ownerRef: OwnerRef;
      faceValue: number;
      cashValue: number;
      costBasis: number;
      premiumAmount: number;
      premiumYears: number | null;
      premiumPayer: "owner" | "client" | "spouse" | "both";
      termIssueYear: number | null;
      termLengthYears: number | null;
      endsAtInsuredRetirement: boolean;
      cashValueGrowthMode: "basic" | "free_form";
      premiumScheduleMode: "off" | "scheduled";
      deathBenefitScheduleMode: "off" | "scheduled";
      incomeScheduleMode: "off" | "scheduled";
      postPayoutGrowthRate: number;
      postPayoutModelPortfolioId: string | null;
      cashValueSchedule: {
        year: number;
        cashValue: number | null;
        premiumAmount: number | null;
        income: number | null;
        deathBenefit: number | null;
      }[];
      activationYear: number | null;
      activationYearRef: string | null;
    }>;

    // Look up FM ids for the OwnerRef → account_owners translation.
    const fmRows = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id));
    const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
    const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

    await db.transaction(async (tx) => {
      // --- accounts row updates (ownership is NOT stored here) ---
      const acctUpdates: Record<string, unknown> = {};
      if (input.name !== undefined) acctUpdates.name = input.name;
      if (input.insuredPerson !== undefined) {
        acctUpdates.insuredPerson = input.insuredPerson;
      }
      if (input.cashValue !== undefined) {
        acctUpdates.value = String(input.cashValue);
      }
      if (input.policyType !== undefined) {
        acctUpdates.subType = mapPolicyTypeToSubType(input.policyType);
      }
      if (input.activationYear !== undefined) {
        acctUpdates.activationYear = input.activationYear ?? null;
      }
      if (input.activationYearRef !== undefined) {
        acctUpdates.activationYearRef = input.activationYearRef ?? null;
      }
      if (Object.keys(acctUpdates).length > 0) {
        acctUpdates.updatedAt = new Date();
        await tx
          .update(accounts)
          .set(acctUpdates)
          .where(and(eq(accounts.id, policyId), eq(accounts.clientId, id)));
      }

      // --- account_owners: full replacement when ownerRef is in the patch ---
      if (input.ownerRef !== undefined) {
        await tx
          .delete(accountOwners)
          .where(eq(accountOwners.accountId, policyId));
        const ownerRows = ownerRefToAccountOwnerRows(
          input.ownerRef as OwnerRef,
          { clientFmId, spouseFmId },
        );
        if (ownerRows.length > 0) {
          await tx.insert(accountOwners).values(
            ownerRows.map((r) => ({
              accountId: policyId,
              familyMemberId: r.familyMemberId,
              entityId: r.entityId,
              externalBeneficiaryId: r.externalBeneficiaryId,
              percent: r.percent,
            })),
          );
        }
      }

      // --- life_insurance_policies row updates ---
      const policyUpdates: Record<string, unknown> = {};
      if (input.faceValue !== undefined) {
        policyUpdates.faceValue = String(input.faceValue);
      }
      if (input.costBasis !== undefined) {
        policyUpdates.costBasis = String(input.costBasis);
      }
      if (input.premiumAmount !== undefined) {
        policyUpdates.premiumAmount = String(input.premiumAmount);
      }
      if (input.premiumYears !== undefined) {
        policyUpdates.premiumYears = input.premiumYears ?? null;
      }
      if (input.premiumPayer !== undefined) {
        policyUpdates.premiumPayer = input.premiumPayer;
      }
      if (input.policyType !== undefined) {
        policyUpdates.policyType = input.policyType;
      }
      if (input.termIssueYear !== undefined) {
        policyUpdates.termIssueYear = input.termIssueYear ?? null;
      }
      if (input.termLengthYears !== undefined) {
        policyUpdates.termLengthYears = input.termLengthYears ?? null;
      }
      if (input.endsAtInsuredRetirement !== undefined) {
        policyUpdates.endsAtInsuredRetirement = input.endsAtInsuredRetirement;
      }
      if (input.cashValueGrowthMode !== undefined) {
        policyUpdates.cashValueGrowthMode = input.cashValueGrowthMode;
      }
      if (input.premiumScheduleMode !== undefined) {
        policyUpdates.premiumScheduleMode = input.premiumScheduleMode;
      }
      if (input.deathBenefitScheduleMode !== undefined) {
        policyUpdates.deathBenefitScheduleMode = input.deathBenefitScheduleMode;
      }
      if (input.incomeScheduleMode !== undefined) {
        policyUpdates.incomeScheduleMode = input.incomeScheduleMode;
      }
      if (input.postPayoutGrowthRate !== undefined) {
        policyUpdates.postPayoutGrowthRate = String(input.postPayoutGrowthRate);
      }
      if (input.postPayoutModelPortfolioId !== undefined) {
        policyUpdates.postPayoutModelPortfolioId = input.postPayoutModelPortfolioId ?? null;
      }
      if (Object.keys(policyUpdates).length > 0) {
        policyUpdates.updatedAt = new Date();
        await tx
          .update(lifeInsurancePolicies)
          .set(policyUpdates)
          .where(eq(lifeInsurancePolicies.accountId, policyId));
      }

      // --- cash-value schedule: full replacement when provided ---
      if (input.cashValueSchedule !== undefined) {
        await tx
          .delete(lifeInsuranceCashValueSchedule)
          .where(eq(lifeInsuranceCashValueSchedule.policyId, policyId));
        if (input.cashValueSchedule.length > 0) {
          await tx.insert(lifeInsuranceCashValueSchedule).values(
            input.cashValueSchedule.map((r) => ({
              policyId,
              year: r.year,
              cashValue: r.cashValue != null ? String(r.cashValue) : null,
              premiumAmount: r.premiumAmount != null ? String(r.premiumAmount) : null,
              income: r.income != null ? String(r.income) : null,
              deathBenefit: r.deathBenefit != null ? String(r.deathBenefit) : null,
            })),
          );
        }
      }
    });

    await recordAudit({
      action: "insurance_policy.update",
      resourceType: "insurance_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: target.name, fieldsChanged: Object.keys(input) }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "PATCH /api/clients/[id]/insurance-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/insurance-policies/[policyId]
// Removes the underlying accounts row; FK cascades on
// life_insurance_policies.accountId and life_insurance_cash_value_schedule.policyId
// clean up the dependent rows.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const { id, policyId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // Tenant-isolation: same guard as PATCH.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, policyId),
          eq(accounts.clientId, id),
          eq(accounts.category, "life_insurance"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    await db
      .delete(accounts)
      .where(and(eq(accounts.id, policyId), eq(accounts.clientId, id)));

    await recordAudit({
      action: "insurance_policy.delete",
      resourceType: "insurance_policy",
      resourceId: policyId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: target.name ?? null }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/clients/[id]/insurance-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
