import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  accounts,
  lifeInsurancePolicies,
  lifeInsuranceCashValueSchedule,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { insurancePolicyUpdateSchema } from "@/lib/schemas/insurance-policies";

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
    const firmId = await requireOrgId();
    const { id, policyId } = await params;

    // Verify client belongs to this firm.
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

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
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    // The update schema's inferred type is loose (see schema's
    // Object.fromEntries cast) — narrow it here so field accesses are typed.
    const input = parsed.data as Partial<{
      name: string;
      policyType: "term" | "whole" | "universal" | "variable";
      insuredPerson: "client" | "spouse" | "joint";
      owner: "client" | "spouse" | "joint";
      ownerEntityId: string | null;
      faceValue: number;
      cashValue: number;
      costBasis: number;
      premiumAmount: number;
      premiumYears: number | null;
      termIssueYear: number | null;
      termLengthYears: number | null;
      endsAtInsuredRetirement: boolean;
      cashValueGrowthMode: "basic" | "free_form";
      postPayoutMergeAccountId: string | null;
      postPayoutGrowthRate: number;
      cashValueSchedule: { year: number; cashValue: number }[];
    }>;

    await db.transaction(async (tx) => {
      // --- accounts row updates ---
      const acctUpdates: Record<string, unknown> = {};
      if (input.name !== undefined) acctUpdates.name = input.name;
      if (input.owner !== undefined) acctUpdates.owner = input.owner;
      if (input.ownerEntityId !== undefined) {
        acctUpdates.ownerEntityId = input.ownerEntityId ?? null;
      }
      if (input.insuredPerson !== undefined) {
        acctUpdates.insuredPerson = input.insuredPerson;
      }
      if (input.cashValue !== undefined) {
        acctUpdates.value = String(input.cashValue);
      }
      if (input.policyType !== undefined) {
        acctUpdates.subType = mapPolicyTypeToSubType(input.policyType);
      }
      if (Object.keys(acctUpdates).length > 0) {
        acctUpdates.updatedAt = new Date();
        await tx
          .update(accounts)
          .set(acctUpdates)
          .where(and(eq(accounts.id, policyId), eq(accounts.clientId, id)));
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
      if (input.postPayoutMergeAccountId !== undefined) {
        policyUpdates.postPayoutMergeAccountId = input.postPayoutMergeAccountId ?? null;
      }
      if (input.postPayoutGrowthRate !== undefined) {
        policyUpdates.postPayoutGrowthRate = String(input.postPayoutGrowthRate);
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
              cashValue: String(r.cashValue),
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
      metadata: { name: target.name, fieldsChanged: Object.keys(input) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
    const firmId = await requireOrgId();
    const { id, policyId } = await params;

    // Verify client belongs to this firm.
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

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
      metadata: { name: target.name ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "DELETE /api/clients/[id]/insurance-policies/[policyId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
