import { and, eq } from "drizzle-orm";

import { accountOwners, accounts } from "@/db/schema";
import { validateOwnersShape, validateOwnersTenant } from "@/lib/ownership";

import { getExistingId, type ImportPayload } from "../types";
import { loadFamilyRoleIds, type FamilyRoleIds } from "./family-resolver";
import { emptyResult, type CommitContext, type CommitResult, type Tx } from "./types";

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
      const [inserted] = await tx
        .insert(accounts)
        .values({
          clientId: ctx.clientId,
          scenarioId: ctx.scenarioId,
          name: row.name,
          category: row.category ?? "taxable",
          subType: row.subType ?? "other",
          value: row.value != null ? String(row.value) : "0",
          basis: row.basis != null ? String(row.basis) : "0",
          accountNumberLast4: row.accountNumberLast4 ?? null,
          custodian: row.custodian ?? null,
          growthRate: row.growthRate != null ? String(row.growthRate) : null,
          growthSource: row.growthSource ?? "default",
          modelPortfolioId: row.modelPortfolioId ?? null,
          rmdEnabled: row.rmdEnabled ?? false,
          source: "extracted",
        })
        .returning({ id: accounts.id });

      await writeImportedOwners(tx, inserted.id, row, ctx.clientId, family);
      result.created += 1;
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
    if (row.rmdEnabled != null) updates.rmdEnabled = row.rmdEnabled;
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
    result.updated += 1;
  }

  return result;
}

/**
 * Persist the advisor-confirmed `owners[]` from the review step, validated for
 * shape + tenant ownership. Any validation/tenant failure (e.g. a family member
 * not yet visible) falls back to coarse synthesis from the `owner` enum so the
 * account is never left silently ownerless.
 */
async function writeImportedOwners(
  tx: Tx,
  accountId: string,
  row: ImportPayload["accounts"][number],
  clientId: string,
  family: FamilyRoleIds,
): Promise<void> {
  const owners = row.owners;
  if (Array.isArray(owners) && owners.length > 0) {
    const shape = validateOwnersShape(owners);
    if ("owners" in shape) {
      const tenantErr = await validateOwnersTenant(shape.owners, clientId);
      if (!tenantErr) {
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
  await synthesizeAccountOwners(tx, accountId, row.owner, family);
}

async function synthesizeAccountOwners(
  tx: Tx,
  accountId: string,
  owner: "client" | "spouse" | "joint" | undefined,
  family: { clientFmId: string | null; spouseFmId: string | null },
): Promise<void> {
  const { clientFmId, spouseFmId } = family;

  if (owner === "joint" && clientFmId && spouseFmId) {
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
