import { and, eq } from "drizzle-orm";

import { accountOwners, accounts } from "@/db/schema";

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
          rmdEnabled: row.rmdEnabled ?? false,
          source: "extracted",
        })
        .returning({ id: accounts.id });

      await synthesizeAccountOwners(tx, inserted.id, row.owner, family);
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
