// src/lib/clients/insurance-policies-writes.ts
/**
 * Life insurance policy write core — the POST and PATCH handlers of
 * src/app/api/clients/[id]/insurance-policies/**, moved verbatim (Plan 4, D3)
 * so the fact finder save can write a policy on its transaction. A policy is an
 * `accounts` row (category life_insurance; its id is the policy's id), its
 * `life_insurance_policies` row, `account_owners` from the OwnerRef, and an
 * optional cash value schedule. The routes keep their gates and answer with
 * these results; an error's `body` is the route's own `{ error, issues }`.
 *
 * With `tx` every statement runs on it — the owner check, the family member
 * lookup a joint owner reads, the policy's own read, the writes and the audit
 * row — so an owner or a co-client written earlier in the same save counts.
 * The base-case lookup stays on `db` (D1): the scenario exists before any save.
 *
 * The routes answer a missing base case / policy before they read the body:
 * they call getBaseCaseScenarioId / verifyPolicy first, and the cores repeat
 * the check (the save's path).
 *
 * Shaped by the POST route test's mocks (owner-ref-scope.test.ts):
 * `@/lib/clients/authz` there has only requireClientEditAccess, so the
 * base-case lookup is this file's own select (base-case.ts calls
 * verifyClientAccess); `@/lib/audit` has only recordAudit, so the audit stays
 * metadata-style; without `tx` the write opens `db.transaction`. `actorId` is
 * optional: the routes pass none, and the audit reads the Clerk session as it
 * always has. `carrier` / `policyNumberLast4` aren't in the schemas, so neither
 * path writes them (the fact finder save's writer does).
 */
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
import { recordAudit } from "@/lib/audit";
import { handleOf, inTransaction, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import {
  insurancePolicyCreateSchema,
  insurancePolicyUpdateSchema,
} from "@/lib/schemas/insurance-policies";
import {
  ownerRefToAccountOwnerRows,
  type OwnerRef,
} from "@/lib/insurance-policies/owner-ref";
import { mapPolicyTypeToSubType } from "@/lib/insurance-policies/sub-type";
import { assertOwnerRefInClient } from "@/lib/insurance-policies/assert-owner-ref";
import { writeError, type EntityWriteResult } from "./entity-write-result";

/** The client's base-case scenario — a plain select; the routes' gates checked access. */
export async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// Creates a life-insurance account + policy + (optional) free-form
// cash-value schedule in a single transaction so a partial write can't
// leave a policy orphaned from its account.
export async function createInsurancePolicyForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId: id, firmId, actorId, input: body, crossFirmMeta } = args;
  const handle = handleOf(args);

  const scenarioId = await getBaseCaseScenarioId(id);
  if (!scenarioId) {
    return writeError(404, "Client not found");
  }

  const parsed = insurancePolicyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
  }
  const input = parsed.data;

  const ownerCheck = await assertOwnerRefInClient(id, input.ownerRef as OwnerRef, args.tx);
  if (!ownerCheck.ok) {
    return writeError(400, ownerCheck.reason);
  }

  // Look up FM ids so we can synthesize account_owners rows.
  const fmRows = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, id));
  const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
  const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

  const policyAccountId = await inTransaction(args, async (tx) => {
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
        activationYear: input.activationYear ?? null,
        activationYearRef: (input.activationYearRef ?? null) as (typeof accounts.$inferInsert)["activationYearRef"],
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
    actorId,
    tx: args.tx,
    metadata: { name: input.name, policyType: input.policyType, ...(crossFirmMeta ?? {}) },
  });

  return { ok: true, data: { id: policyAccountId }, resourceId: policyAccountId };
}

// Tenant-isolation: confirm the target account exists, belongs to this
// client, and is a life-insurance account. Without this, an attacker
// with any known account UUID could mutate or delete unrelated rows
// through this endpoint. The PATCH route runs it before reading the body.
export async function verifyPolicy(
  policyId: string,
  clientId: string,
  handle?: DbOrTx,
): Promise<typeof accounts.$inferSelect | null> {
  const [target] = await (handle ?? db)
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, policyId),
        eq(accounts.clientId, clientId),
        eq(accounts.category, "life_insurance"),
      ),
    );
  return target ?? null;
}

// Partial update of a life-insurance policy (the underlying account +
// policy row + optional full replacement of the free-form cash-value
// schedule).
export async function updateInsurancePolicyForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    policyId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<{ id: string }>> {
  const { clientId: id, firmId, actorId, policyId, input: body, crossFirmMeta } = args;
  const handle = handleOf(args);

  const target = await verifyPolicy(policyId, id, args.tx);
  if (!target) {
    return writeError(404, "Policy not found");
  }

  const parsed = insurancePolicyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return writeError(400, "Invalid body", { error: "Invalid body", issues: formatZodIssues(parsed.error) });
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

  if (input.ownerRef !== undefined) {
    const ownerCheck = await assertOwnerRefInClient(id, input.ownerRef as OwnerRef, args.tx);
    if (!ownerCheck.ok) {
      return writeError(400, ownerCheck.reason);
    }
  }

  // Look up FM ids for the OwnerRef → account_owners translation.
  const fmRows = await handle
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, id));
  const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
  const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

  await inTransaction(args, async (tx) => {
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
    actorId,
    tx: args.tx,
    metadata: { name: target.name, fieldsChanged: Object.keys(input), ...(crossFirmMeta ?? {}) },
  });

  return { ok: true, data: { id: policyId }, resourceId: policyId };
}
