import { and, eq } from "drizzle-orm";

import {
  accountOwners,
  accounts,
  lifeInsurancePolicies,
  type accountSubTypeEnum,
} from "@/db/schema";

import type { ExtractedLifePolicy, LifePolicyType } from "@/lib/extraction/types";

import { getExistingId, type ImportPayload } from "../types";
import { loadFamilyRoleIds, type FamilyRoleIds } from "./family-resolver";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

type AccountSubType = (typeof accountSubTypeEnum.enumValues)[number];

const SUB_TYPE_BY_POLICY: Record<LifePolicyType, AccountSubType> = {
  term: "term",
  whole: "whole_life",
  universal: "universal_life",
  variable: "variable_life",
};

/**
 * Commits the life-insurance tab. Each policy is a TWO-STEP write:
 *   1. Upsert an `accounts` row (category='life_insurance', subType derived
 *      from policyType). On insert we synthesize accountOwners using the
 *      insuredPerson enum.
 *   2. Upsert a `life_insurance_policies` row keyed by accountId (the
 *      table's PK is accountId — one policy per account row).
 *
 * Match annotation kinds:
 *   new   → INSERT both rows, synthesize owners
 *   exact → UPDATE both rows; existingId points at the accounts.id /
 *           life_insurance_policies.account_id (same value, since the policy
 *           shares the account's PK)
 *   fuzzy → SKIP
 *
 * Field map (accounts side):
 *   name: keep-existing
 *   category: replace ("life_insurance")
 *   subType: replace
 *   value: replace (cash value if extracted, else 0)
 *
 * Field map (policy side):
 *   faceValue, costBasis, premiumAmount: replace
 *   policyType, insuredPerson: replace
 *   carrier, policyNumberLast4: replace-if-non-null
 *   termIssueYear, termLengthYears: replace-if-non-null
 */
export async function commitLifeInsurance(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  preloadedFamily?: FamilyRoleIds,
): Promise<CommitResult> {
  const result = emptyResult();
  const family = preloadedFamily ?? (await loadFamilyRoleIds(tx, ctx.clientId));
  const now = new Date();

  for (const row of payload.lifePolicies) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    const subType = SUB_TYPE_BY_POLICY[row.policyType];

    if (kind === "new") {
      const [acct] = await tx
        .insert(accounts)
        .values({
          clientId: ctx.clientId,
          scenarioId: ctx.scenarioId,
          name: row.accountName,
          category: "life_insurance",
          subType,
          insuredPerson: row.insuredPerson,
          value: "0",
          basis: "0",
          source: "extracted",
        })
        .returning({ id: accounts.id });

      await synthesizeLifePolicyOwners(tx, acct.id, row.insuredPerson, family);

      await tx.insert(lifeInsurancePolicies).values({
        accountId: acct.id,
        policyType: row.policyType,
        carrier: row.carrier ?? null,
        policyNumberLast4: row.policyNumberLast4 ?? null,
        faceValue: String(row.faceValue),
        costBasis: row.costBasis != null ? String(row.costBasis) : "0",
        premiumAmount: row.premiumAmount != null ? String(row.premiumAmount) : "0",
        premiumYears: row.premiumYears ?? null,
        termIssueYear: row.termIssueYear ?? null,
        termLengthYears: row.termLengthYears ?? null,
      });

      result.created += 1;
      continue;
    }

    // exact — both updates target the matched accountId
    const accountId = getExistingId(row);
    if (!accountId) {
      result.skipped += 1;
      continue;
    }
    // insuredPerson lives on the accounts row, not the policy row.
    await tx
      .update(accounts)
      .set({
        category: "life_insurance",
        subType,
        insuredPerson: row.insuredPerson,
        updatedAt: now,
      })
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.clientId, ctx.clientId),
          eq(accounts.scenarioId, ctx.scenarioId),
        ),
      );

    const policyUpdates: Record<string, unknown> = {
      policyType: row.policyType,
      faceValue: String(row.faceValue),
      updatedAt: now,
    };
    if (row.costBasis !== undefined) policyUpdates.costBasis = String(row.costBasis);
    if (row.premiumAmount !== undefined) {
      policyUpdates.premiumAmount = String(row.premiumAmount);
    }
    if (row.carrier != null) policyUpdates.carrier = row.carrier;
    if (row.policyNumberLast4 != null) {
      policyUpdates.policyNumberLast4 = row.policyNumberLast4;
    }
    if (row.termIssueYear != null) policyUpdates.termIssueYear = row.termIssueYear;
    if (row.termLengthYears != null) {
      policyUpdates.termLengthYears = row.termLengthYears;
    }

    await tx
      .update(lifeInsurancePolicies)
      .set(policyUpdates)
      .where(eq(lifeInsurancePolicies.accountId, accountId));

    result.updated += 1;
  }

  return result;
}

async function synthesizeLifePolicyOwners(
  tx: Tx,
  accountId: string,
  insured: ExtractedLifePolicy["insuredPerson"],
  family: { clientFmId: string | null; spouseFmId: string | null },
): Promise<void> {
  const { clientFmId, spouseFmId } = family;

  if (insured === "joint" && clientFmId && spouseFmId) {
    await tx.insert(accountOwners).values([
      { accountId, familyMemberId: clientFmId, entityId: null, percent: "0.5000" },
      { accountId, familyMemberId: spouseFmId, entityId: null, percent: "0.5000" },
    ]);
    return;
  }

  if (insured === "spouse" && spouseFmId) {
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: spouseFmId,
      entityId: null,
      percent: "1.0000",
    });
    return;
  }

  if (clientFmId) {
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: clientFmId,
      entityId: null,
      percent: "1.0000",
    });
  }
}
