import { and, eq, sql } from "drizzle-orm";

import { accountOwners, accounts, lifeInsurancePolicies, sourceEnum } from "@/db/schema";
import { isRmdEligibleSubType } from "@/engine/rmd";
import { is529Account } from "@/lib/accounts/is-529";
import type { AccountCategory, AccountSubType, ExtractedAccount } from "@/lib/extraction/types";
import {
  RETIREMENT_SUBTYPES,
  validateOwnersShape,
  validateOwnersTenant,
} from "@/lib/ownership";

import { getExistingId, linkCreated, type ImportPayload } from "../types";
import {
  loadFamilyRoleIds,
  synthesizeAccountOwners,
  type FamilyRoleIds,
} from "./family-resolver";
import { writeAccountHoldings } from "./holdings";
import { accountHoldingsGuardrail } from "./holdings-guardrail";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

type SourceValue = (typeof sourceEnum.enumValues)[number];
const EXTERNAL_SOURCES = new Set<SourceValue>(["orion", "schwab", "addepar", "plaid"]);
export function externalProviderToSource(
  externalProvider: string | null | undefined,
): SourceValue {
  if (
    externalProvider &&
    EXTERNAL_SOURCES.has(externalProvider as SourceValue)
  )
    return externalProvider as SourceValue;
  return "extracted";
}

const POLICY_TYPE_BY_SUBTYPE: Record<string, "term" | "whole" | "universal" | "variable"> = {
  term: "term",
  whole_life: "whole",
  universal_life: "universal",
  variable_life: "variable",
};

/**
 * The account category to persist. Extraction historically classified 529s as
 * `taxable` + `subType: "529"` because `education_savings` was not in its
 * category union at all (fixed in the prompt, but old payloads persist and the
 * model can still ignore the rule). A 529 left as `taxable` is spendable in the
 * withdrawal waterfall and invisible to the dedicated-funding picker, so the
 * subType wins here.
 */
export function resolveAccountCategory(
  row: { name?: string; category?: AccountCategory; subType?: AccountSubType },
): AccountCategory {
  if (is529Account(row)) return "education_savings";
  return row.category ?? "taxable";
}

/**
 * The 529-only columns for a row, resolved against the household roster.
 *
 * A 529 is attributed to its designated BENEFICIARY and funded by its
 * GRANTOR; each is stored as EITHER a household family-member id OR a plain
 * name, never both (see the accounts-table comment). The ids arrive on
 * advisor-edited payload JSON, so an id this household doesn't have is
 * discarded rather than written — it would be a cross-tenant FK.
 *
 * A discarded id does not fall back to the paired name — BOTH halves are
 * dropped. The two fields are the two halves of one choice, and the review step
 * clears one when the advisor picks the other, so a name sitting behind a
 * rejected id is stale, not a second opinion. The row then commits with no
 * beneficiary at all, which warns rather than silently naming the wrong child.
 */
export function education529Columns(
  row: Pick<
    ExtractedAccount,
    | "beneficiaryFamilyMemberId"
    | "beneficiaryName"
    | "grantorFamilyMemberId"
    | "grantorName"
  >,
  allFmIds: Set<string> | undefined,
): {
  beneficiaryFamilyMemberId: string | null;
  beneficiaryName: string | null;
  grantorFamilyMemberId: string | null;
  grantorName: string | null;
} {
  // A rejected id takes its paired name down with it — see the docstring. A
  // missing id is a different case: nobody picked anybody, so the printed name
  // is all there is and it stands on its own.
  const resolve = (
    id: string | null | undefined,
    name: string | null | undefined,
  ): { id: string | null; name: string | null } => {
    if (id) return allFmIds?.has(id) ? { id, name: null } : { id: null, name: null };
    return { id: null, name: name?.trim() || null };
  };
  const beneficiary = resolve(row.beneficiaryFamilyMemberId, row.beneficiaryName);
  const grantor = resolve(row.grantorFamilyMemberId, row.grantorName);
  return {
    beneficiaryFamilyMemberId: beneficiary.id,
    beneficiaryName: beneficiary.name,
    grantorFamilyMemberId: grantor.id,
    grantorName: grantor.name,
  };
}

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
 *
 * 529s (`education_savings`, or any row whose subType is "529") deviate on
 * three points, matching what accounts-writes.ts enforces for hand-entered
 * ones: RMDs are forced off, the grantor/beneficiary columns are written from
 * the review step's resolution, and NO account_owners rows are written.
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
      const is529 = is529Account(row);
      const edu529 = is529 ? education529Columns(row, family.allFmIds) : null;
      if (edu529 && !edu529.beneficiaryFamilyMemberId && !edu529.beneficiaryName) {
        // Not fatal — refusing the row would strand the whole import over one
        // missing name — but the account lands unattributed, and the account
        // form will refuse to save it until someone supplies a beneficiary.
        result.warnings.push(
          `${row.name}: 529 committed with no designated beneficiary — set one on the account.`,
        );
      }
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
          category: resolveAccountCategory(row),
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
          // A 529 never takes one, whatever an older payload claims: the review
          // step hides the control, so an inherited `true` would be invisible.
          rmdEnabled: is529 ? false : row.rmdEnabled ?? isRmdEligibleSubType(subType),
          ...(edu529 ?? {}),
          deriveFromHoldings: guard.deriveFromHoldings,
          notes: guard.note,
          source: externalProviderToSource(row.externalProvider),
          externalProvider: row.externalProvider ?? null,
          externalId: row.externalId ?? null,
          lastSyncedAt: row.externalProvider ? now : null,
        })
        .returning({ id: accounts.id });

      const isRetirement = (RETIREMENT_SUBTYPES as readonly string[]).includes(
        subType,
      );
      // 529s carry NO account_owners rows — the beneficiary columns above are
      // authoritative and a sentinel owner is synthesized at engine-load time.
      // Same rule as accounts-writes.ts; writing owners here would put the
      // balance back into the household estate the beneficiary took it out of.
      if (!is529) {
        await writeImportedOwners(tx, inserted.id, row, ctx.clientId, family, isRetirement);
      }
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
      linkCreated(row, inserted.id);
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
    // Recompute category when the row explicitly sets one (normal replace, per
    // the field map above) or when subType alone heals to a 529 (Task 4). A
    // subType edit to anything else, with category left untouched by the
    // review step, must NOT fall through resolveAccountCategory's `?? "taxable"`
    // default and clobber an existing category the advisor never touched.
    if (row.category !== undefined || is529Account(row)) {
      updates.category = resolveAccountCategory(row);
    }
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
    // The incoming row is the ONLY evidence here — `before` isn't loaded — so
    // the 529 columns are written only when the incoming row itself says 529.
    // A non-529 row must not null them out: it would strip the beneficiary off
    // an existing 529 the extraction simply failed to classify.
    const updateIs529 = is529Account(row);
    if (updateIs529) {
      Object.assign(updates, education529Columns(row, family.allFmIds));
      updates.rmdEnabled = false;
    }
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
      updates.source = externalProviderToSource(row.externalProvider);
      updates.externalProvider = row.externalProvider;
      updates.externalId = row.externalId ?? null;
      updates.lastSyncedAt = now;
    }
    // `.returning()` is the tenancy gate for the owners delete below, not a
    // convenience: `existingId` comes straight off payload JSON, and
    // account_owners has no clientId of its own to scope a delete by. The
    // UPDATE is already scoped, so an id belonging to another firm matches
    // nothing and returns no rows — which is exactly the signal that this
    // account is not ours to touch.
    const updatedRows = await tx
      .update(accounts)
      .set(updates)
      .where(
        and(
          eq(accounts.id, existingId),
          eq(accounts.clientId, ctx.clientId),
          eq(accounts.scenarioId, ctx.scenarioId),
        ),
      )
      .returning({ id: accounts.id });
    if (updateIs529 && updatedRows.length > 0) {
      // Reclassifying an existing account INTO a 529 has to clear whatever
      // ownership it used to carry, or the balance stays in the household
      // estate through both doors at once.
      await tx.delete(accountOwners).where(eq(accountOwners.accountId, existingId));
    }
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
