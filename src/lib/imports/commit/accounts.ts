import { and, eq, sql } from "drizzle-orm";

import { accountOwners, accounts, lifeInsurancePolicies } from "@/db/schema";
import { isRmdEligibleSubType } from "@/engine/rmd";
import {
  RETIREMENT_SUBTYPES,
  validateOwnersShape,
  validateOwnersTenant,
} from "@/lib/ownership";

import { getExistingId, type ImportPayload } from "../types";
import { loadFamilyRoleIds, type FamilyRoleIds } from "./family-resolver";
import { writeAccountHoldings } from "./holdings";
import { accountHoldingsGuardrail } from "./holdings-guardrail";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

const POLICY_TYPE_BY_SUBTYPE: Record<string, "term" | "whole" | "universal" | "variable"> = {
  term: "term",
  whole_life: "whole",
  universal_life: "universal",
  variable_life: "variable",
};

/**
 * Commits the accounts tab. For each annotated row in `payload.accounts`:
 *  - kind='new'   → INSERT a row, then synthesize accountOwners from the
 *                   extracted `owner: 'client'|'spouse'|'joint'` enum (only
 *                   when the corresponding role='client'/'spouse' familyMember
 *                   row exists; otherwise we leave it ownerless and let the
 *                   advisor wire ownership via the family page).
 *  - kind='exact' → UPDATE the existing row using the field map below.
 *                   accountOwners are NOT touched on update — advisor-managed.
 *  - kind='fuzzy' → SKIP (advisor must resolve the candidate in the wizard).
 *
 * Field map (per plan):
 *   name: keep-existing (advisor may have renamed the account)
 *   category, subType: replace
 *   value, basis, accountNumberLast4, custodian: replace
 *   growthRate, rmdEnabled: replace-if-non-null
 */
export async function commitAccounts(
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  preloadedFamily?: FamilyRoleIds,
): Promise<CommitResult> {
  const result = emptyResult();
  const family = preloadedFamily ?? (await loadFamilyRoleIds(tx, ctx.clientId));
  const now = new Date();

  for (const row of payload.accounts) {
    const kind = row.match?.kind ?? "new";

    if (kind === "fuzzy") {
      result.skipped += 1;
      continue;
    }

    if (kind === "new") {
      // category is required by the schema; default to "taxable" when the
      // extraction failed to classify so the row is still committable.
      const subType = row.subType ?? "other";
      // Fresh row: unconditional write is safe — for a no-holdings/no-value row
      // the guard returns the column defaults (deriveFromHoldings=true, note=null),
      // and there is no existing `notes` to preserve.
      const guard = accountHoldingsGuardrail(row);
      const [inserted] = await tx
        .insert(accounts)
        .values({
          clientId: ctx.clientId,
          scenarioId: ctx.scenarioId,
          name: row.name,
          category: row.category ?? "taxable",
          subType,
          value: row.value != null ? String(row.value) : "0",
          basis: row.basis != null ? String(row.basis) : "0",
          accountNumberLast4: row.accountNumberLast4 ?? null,
          custodian: row.custodian ?? null,
          growthRate: row.growthRate != null ? String(row.growthRate) : null,
          growthSource: row.growthSource ?? "default",
          modelPortfolioId: row.modelPortfolioId ?? null,
          tickerPortfolioId: row.tickerPortfolioId ?? null,
          // RMDs default ON for pre-tax retirement sub-types when the
          // extraction didn't capture an explicit flag — matches the
          // add-account form and quick-start wizard. Roth/non-retirement off.
          rmdEnabled: row.rmdEnabled ?? isRmdEligibleSubType(subType),
          deriveFromHoldings: guard.deriveFromHoldings,
          notes: guard.note,
          source: row.externalProvider ? "orion" : "extracted",
          externalProvider: row.externalProvider ?? null,
          externalId: row.externalId ?? null,
          lastSyncedAt: row.externalProvider ? now : null,
        })
        .returning({ id: accounts.id });

      const isRetirement = (RETIREMENT_SUBTYPES as readonly string[]).includes(
        subType,
      );
      await writeImportedOwners(tx, inserted.id, row, ctx.clientId, family, isRetirement);
      await writeAccountHoldings(
        tx,
        inserted.id,
        row.holdings ?? [],
        ctx.resolvedHoldings ?? new Map(),
        false,
        ctx.holdingsAccountIds,
      );
      // Defensive: a life-insurance account committed through the accounts
      // path (older drafts / excel imports) would otherwise have no policy
      // satellite, so the Insurance tab can't manage it. Net-worth-statement
      // imports route policies through lifePolicies (commitLifeInsurance) and
      // never hit this branch.
      if ((row.category ?? "taxable") === "life_insurance") {
        await tx.insert(lifeInsurancePolicies).values({
          accountId: inserted.id,
          policyType: POLICY_TYPE_BY_SUBTYPE[subType] ?? "whole",
          faceValue: "0",
        });
      }
      result.created += 1;
      if (guard.note) result.warnings.push(`${row.name}: ${guard.note}`);
      continue;
    }

    // exact — UPDATE the matched row, preserving name (keep-existing).
    const existingId = getExistingId(row);
    if (!existingId) {
      result.skipped += 1;
      continue;
    }
    const updates: Record<string, unknown> = { updatedAt: now };
    if (row.category !== undefined) updates.category = row.category;
    if (row.subType !== undefined) updates.subType = row.subType;
    if (row.value !== undefined) updates.value = String(row.value);
    if (row.basis !== undefined) updates.basis = String(row.basis);
    if (row.accountNumberLast4 !== undefined) updates.accountNumberLast4 = row.accountNumberLast4;
    if (row.custodian !== undefined) updates.custodian = row.custodian;
    if (row.growthRate != null) updates.growthRate = String(row.growthRate);
    if (row.growthSource !== undefined) updates.growthSource = row.growthSource;
    if (row.modelPortfolioId !== undefined) updates.modelPortfolioId = row.modelPortfolioId;
    if (row.tickerPortfolioId !== undefined) updates.tickerPortfolioId = row.tickerPortfolioId;
    if (row.rmdEnabled != null) updates.rmdEnabled = row.rmdEnabled;
    if (row.holdings?.length) {
      const guard = accountHoldingsGuardrail(row);
      updates.deriveFromHoldings = guard.deriveFromHoldings;
      if (guard.note) {
        // append to existing notes (don't clobber advisor notes)
        updates.notes = sql`COALESCE(${accounts.notes} || E'\n', '') || ${guard.note}`;
        result.warnings.push(`${row.name}: ${guard.note}`);
      }
    }
    if (row.externalProvider) {
      updates.source = "orion";
      updates.externalProvider = row.externalProvider;
      updates.externalId = row.externalId ?? null;
      updates.lastSyncedAt = now;
    }
    await tx
      .update(accounts)
      .set(updates)
      .where(
        and(
          eq(accounts.id, existingId),
          eq(accounts.clientId, ctx.clientId),
          eq(accounts.scenarioId, ctx.scenarioId),
        ),
      );
    await writeAccountHoldings(
      tx,
      existingId,
      row.holdings ?? [],
      ctx.resolvedHoldings ?? new Map(),
      true,
      ctx.holdingsAccountIds,
    );
    result.updated += 1;
  }

  return result;
}

/**
 * Persist the advisor-confirmed `owners[]` from the review step, validated for
 * shape + tenant ownership. Any validation/tenant failure (e.g. a family member
 * not yet visible) falls back to coarse synthesis from the `owner` enum so the
 * account is never left silently ownerless.
 *
 * Retirement accounts (IRA/401k/403b) must have exactly one owner at 100% —
 * enforced by the `account_owners_retirement_check` constraint trigger, which is
 * DEFERRABLE INITIALLY DEFERRED and so fires at COMMIT. The extractor can label
 * such an account 'joint' (e.g. an inherited IRA listed under both spouses); a
 * multi-owner insert would fail that trigger and roll back the entire import.
 * For retirement accounts we therefore collapse any multi-owner set to a single
 * owner via the coarse synthesis below (spouse when the extractor said 'spouse',
 * otherwise the primary client). A single explicit owner already satisfies the
 * rule and is inserted as-is.
 */
async function writeImportedOwners(
  tx: Tx,
  accountId: string,
  row: ImportPayload["accounts"][number],
  clientId: string,
  family: FamilyRoleIds,
  isRetirement: boolean,
): Promise<void> {
  const owners = row.owners;
  if (Array.isArray(owners) && owners.length > 0) {
    const shape = validateOwnersShape(owners);
    if ("owners" in shape) {
      const tenantErr = await validateOwnersTenant(shape.owners, clientId);
      if (!tenantErr) {
        if (isRetirement && shape.owners.length > 1) {
          await synthesizeAccountOwners(tx, accountId, row.owner, family, true);
          return;
        }
        await tx.insert(accountOwners).values(
          shape.owners.map((o) => ({
            accountId,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          })),
        );
        return;
      }
    }
    // validation/tenant failure → fall through to coarse synthesis below.
  }
  await synthesizeAccountOwners(tx, accountId, row.owner, family, isRetirement);
}

async function synthesizeAccountOwners(
  tx: Tx,
  accountId: string,
  owner: "client" | "spouse" | "joint" | undefined,
  family: { clientFmId: string | null; spouseFmId: string | null },
  isRetirement: boolean,
): Promise<void> {
  const { clientFmId, spouseFmId } = family;

  // Retirement accounts can't be jointly held — skip the 50/50 split and fall
  // through to the single-owner branches (spouse if the extractor said 'spouse',
  // otherwise the primary client at 100%).
  if (!isRetirement && owner === "joint" && clientFmId && spouseFmId) {
    await tx.insert(accountOwners).values([
      { accountId, familyMemberId: clientFmId, entityId: null, percent: "0.5000" },
      { accountId, familyMemberId: spouseFmId, entityId: null, percent: "0.5000" },
    ]);
    return;
  }

  if (owner === "spouse" && spouseFmId) {
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: spouseFmId,
      entityId: null,
      percent: "1.0000",
    });
    return;
  }

  // Default: client at 100% (covers explicit 'client', missing/unknown, and
  // 'joint' fallback when the spouse FM row doesn't exist yet). Skip if even
  // the client FM row is missing — the row stays ownerless for now.
  if (clientFmId) {
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: clientFmId,
      entityId: null,
      percent: "1.0000",
    });
  }
}
