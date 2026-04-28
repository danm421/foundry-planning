/**
 * Shared ownership validation helpers used by account and liability API routes.
 *
 * `src/engine/ownership.ts` exists separately — that module is pure projection-time
 * predicates (framework-free). This module is HTTP-route-time validation against the
 * DB and may import Drizzle / Next.js helpers.
 */
import { db } from "@/db";
import {
  familyMembers,
  entities,
  accountOwners,
  liabilityOwners,
  planSettings,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

// ── Transaction type ──────────────────────────────────────────────────────────

/** Inferred from db.transaction callback to avoid coupling to internal Drizzle generics. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Types ─────────────────────────────────────────────────────────────────────

export type RawOwner = {
  kind: string;
  familyMemberId?: unknown;
  entityId?: unknown;
  percent: unknown;
};

export type ValidatedOwner =
  | { kind: "family_member"; familyMemberId: string; percent: number }
  | { kind: "entity"; entityId: string; percent: number };

// ── Shared validation ─────────────────────────────────────────────────────────

/**
 * Validates shape, sum-to-100, and uniqueness of an owners[] array.
 * Returns { error } on failure, { owners: ValidatedOwner[] } on success.
 */
export function validateOwnersShape(
  raw: unknown,
): { error: string } | { owners: ValidatedOwner[] } {
  if (!Array.isArray(raw)) return { error: "owners must be an array" };
  if (raw.length === 0) return { error: "owners must have at least one entry" };

  const validated: ValidatedOwner[] = [];
  for (const item of raw as RawOwner[]) {
    if (!item || typeof item !== "object") {
      return { error: "Each owner entry must be an object" };
    }
    if (item.kind !== "family_member" && item.kind !== "entity") {
      return { error: `Invalid owner kind: ${String(item.kind)}` };
    }
    if (typeof item.percent !== "number" || !isFinite(item.percent)) {
      return { error: "Owner percent must be a finite number" };
    }
    if (item.kind === "family_member") {
      if (typeof item.familyMemberId !== "string" || !item.familyMemberId) {
        return { error: "family_member owner requires familyMemberId" };
      }
      validated.push({
        kind: "family_member",
        familyMemberId: item.familyMemberId,
        percent: item.percent,
      });
    } else {
      if (typeof item.entityId !== "string" || !item.entityId) {
        return { error: "entity owner requires entityId" };
      }
      validated.push({ kind: "entity", entityId: item.entityId, percent: item.percent });
    }
  }

  // Sum-to-100
  const sum = validated.reduce((acc, o) => acc + o.percent, 0);
  if (Math.abs(sum - 1) > 0.0001) return { error: "Owner percents must sum to 100%" };

  // No duplicates
  const seen = new Set<string>();
  for (const o of validated) {
    const key = o.kind === "family_member" ? `fm:${o.familyMemberId}` : `ent:${o.entityId}`;
    if (seen.has(key)) return { error: "Duplicate owner" };
    seen.add(key);
  }

  return { owners: validated };
}

/**
 * Validates that all owner IDs (family members + entities) belong to the given client.
 * Returns { error } on failure, null on success.
 */
export async function validateOwnersTenant(
  owners: ValidatedOwner[],
  clientId: string,
): Promise<{ error: string } | null> {
  for (const o of owners) {
    if (o.kind === "family_member") {
      const [row] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.id, o.familyMemberId), eq(familyMembers.clientId, clientId)));
      if (!row) return { error: "Owner not found for this client" };
    } else {
      const [row] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.id, o.entityId), eq(entities.clientId, clientId)));
      if (!row) return { error: "Owner not found for this client" };
    }
  }
  return null;
}

// ── Accounts-only helpers ─────────────────────────────────────────────────────

export const RETIREMENT_SUBTYPES = [
  "traditional_ira",
  "roth_ira",
  "401k",
  "roth_401k",
  "403b",
  "roth_403b",
] as const;

/**
 * Validates retirement single-owner and default-checking no-mix rules.
 * Returns { error } on failure, null on success.
 */
export function validateAccountOwnershipRules(
  owners: ValidatedOwner[],
  resolvedSubType: string | undefined | null,
  isDefaultChecking: boolean | undefined | null,
): { error: string } | null {
  if (
    resolvedSubType &&
    (RETIREMENT_SUBTYPES as readonly string[]).includes(resolvedSubType)
  ) {
    if (owners.length !== 1 || Math.abs(owners[0].percent - 1) > 0.0001) {
      return { error: "Retirement accounts require a single owner at 100%" };
    }
  }

  if (isDefaultChecking) {
    const hasFm = owners.some((o) => o.kind === "family_member");
    const hasEnt = owners.some((o) => o.kind === "entity");
    if (hasFm && hasEnt) {
      return { error: "Default checking accounts cannot mix family-member and entity owners" };
    }
  }

  return null;
}

/**
 * Synthesizes default owners[] from legacy account fields when the request body omits owners.
 * Mirrors the SQL backfill logic from migration 0055 for accounts.
 */
export async function synthesizeLegacyAccountOwners(
  clientId: string,
  owner: string | undefined | null,
  ownerEntityId: string | undefined | null,
  ownerFamilyMemberId?: string | undefined | null,
): Promise<ValidatedOwner[]> {
  const { id: fmId, role } = familyMembers;

  if (ownerEntityId) {
    return [{ kind: "entity", entityId: ownerEntityId, percent: 1.0 }];
  }

  if (ownerFamilyMemberId) {
    return [{ kind: "family_member", familyMemberId: ownerFamilyMemberId, percent: 1.0 }];
  }

  const fmRows = await db
    .select({ id: fmId, role })
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId)));

  const clientFm = fmRows.find((r) => r.role === "client");
  const spouseFm = fmRows.find((r) => r.role === "spouse");

  if (owner === "joint" && spouseFm && clientFm) {
    return [
      { kind: "family_member", familyMemberId: clientFm.id, percent: 0.5 },
      { kind: "family_member", familyMemberId: spouseFm.id, percent: 0.5 },
    ];
  }

  if (owner === "spouse" && spouseFm) {
    return [{ kind: "family_member", familyMemberId: spouseFm.id, percent: 1.0 }];
  }

  // Default: client at 100% (covers 'client', 'joint' without spouse, and fallbacks)
  if (clientFm) {
    return [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1.0 }];
  }

  return [];
}

// ── Liabilities-only helpers ──────────────────────────────────────────────────

/**
 * Synthesizes default owners[] from legacy liability fields when the request body omits owners.
 * Mirrors the 2-branch backfill from migration 0055: entity 100% OR client family-member 100%.
 * Liabilities have no `owner` enum and no `ownerFamilyMemberId` column.
 */
export async function synthesizeLegacyLiabilityOwners(
  clientId: string,
  ownerEntityId: string | undefined | null,
): Promise<ValidatedOwner[]> {
  if (ownerEntityId) {
    return [{ kind: "entity", entityId: ownerEntityId, percent: 1.0 }];
  }

  // Fall back to client family member at 100%
  const [clientFm] = await db
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(
      and(eq(familyMembers.clientId, clientId), eq(familyMembers.role, "client")),
    );

  if (clientFm) {
    return [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1.0 }];
  }

  return [];
}

// ── Past-dated transfer dual-write ────────────────────────────────────────────

/**
 * Returns the projection start year for the given scenario by reading
 * plan_settings.plan_start_year inside the supplied transaction.
 * Returns null if no plan_settings row exists (dual-write is skipped in that case).
 */
export async function getProjectionStartYearForScenario(
  tx: Tx,
  scenarioId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ planStartYear: planSettings.planStartYear })
    .from(planSettings)
    .where(eq(planSettings.scenarioId, scenarioId));
  return row?.planStartYear ?? null;
}

/**
 * Applies a past-dated ownership transfer to the static junction table.
 *
 * Called only when gift.year < projectionStartYear. For future-dated transfers
 * the engine fans the event at projection time and these tables stay untouched.
 *
 * Algorithm (mirrors engine/ownership.ts `ownersForYear`):
 *  1. Load current owners from the DB.
 *  2. Sum household (family_member) share.
 *  3. Guard: drained household or overdraw → throw with a descriptive message.
 *  4. Scale each household row by factor = (householdShare - percent) / householdShare.
 *  5. Drop rows that scaled to ≈ 0.
 *  6. Merge the recipient entity row (add to existing percent if already present).
 *
 * The caller must pass the enclosing transaction (`tx`) so all writes are atomic.
 */
export async function applyOwnershipTransfer(
  tx: Tx,
  kind: "account" | "liability",
  rowId: string,
  percent: number,
  recipientEntityId: string,
): Promise<void> {
  if (kind === "account") {
    await _applyToAccount(tx, rowId, percent, recipientEntityId);
  } else {
    await _applyToLiability(tx, rowId, percent, recipientEntityId);
  }
}

// ── per-table helpers (avoids `as any` via separate code paths) ───────────────

async function _applyToAccount(
  tx: Tx,
  accountId: string,
  percent: number,
  recipientEntityId: string,
): Promise<void> {
  const owners = await tx
    .select()
    .from(accountOwners)
    .where(eq(accountOwners.accountId, accountId));

  const householdShare = owners
    .filter((o) => o.familyMemberId != null)
    .reduce((s, o) => s + Number(o.percent), 0);

  if (householdShare <= 1e-9) {
    throw new Error(
      `applyOwnershipTransfer(account ${accountId}): no household share remaining (available ${householdShare})`,
    );
  }
  if (percent > householdShare + 1e-9) {
    throw new Error(
      `applyOwnershipTransfer(account ${accountId}): transfer ${percent} exceeds household share ${householdShare}`,
    );
  }

  const factor = (householdShare - percent) / householdShare;

  // Delete all existing rows for this account, then reinsert scaled rows.
  await tx.delete(accountOwners).where(eq(accountOwners.accountId, accountId));

  for (const o of owners) {
    if (o.familyMemberId != null) {
      const newPercent = Number(o.percent) * factor;
      if (newPercent > 1e-9) {
        await tx.insert(accountOwners).values({
          accountId,
          familyMemberId: o.familyMemberId,
          entityId: null,
          percent: newPercent.toString(),
        });
      }
    } else if (o.entityId != null && o.entityId !== recipientEntityId) {
      // Preserve non-recipient entity rows unchanged.
      await tx.insert(accountOwners).values({
        accountId,
        familyMemberId: null,
        entityId: o.entityId,
        percent: o.percent,
      });
    }
    // Recipient entity row is handled by the merge step below.
  }

  // Merge: accumulate existing recipient percent (if any) plus the new transfer.
  const existingRecipient = owners.find((o) => o.entityId === recipientEntityId);
  const finalPercent = percent + (existingRecipient ? Number(existingRecipient.percent) : 0);

  await tx.insert(accountOwners).values({
    accountId,
    familyMemberId: null,
    entityId: recipientEntityId,
    percent: finalPercent.toString(),
  });
}

async function _applyToLiability(
  tx: Tx,
  liabilityId: string,
  percent: number,
  recipientEntityId: string,
): Promise<void> {
  const owners = await tx
    .select()
    .from(liabilityOwners)
    .where(eq(liabilityOwners.liabilityId, liabilityId));

  const householdShare = owners
    .filter((o) => o.familyMemberId != null)
    .reduce((s, o) => s + Number(o.percent), 0);

  if (householdShare <= 1e-9) {
    throw new Error(
      `applyOwnershipTransfer(liability ${liabilityId}): no household share remaining (available ${householdShare})`,
    );
  }
  if (percent > householdShare + 1e-9) {
    throw new Error(
      `applyOwnershipTransfer(liability ${liabilityId}): transfer ${percent} exceeds household share ${householdShare}`,
    );
  }

  const factor = (householdShare - percent) / householdShare;

  await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, liabilityId));

  for (const o of owners) {
    if (o.familyMemberId != null) {
      const newPercent = Number(o.percent) * factor;
      if (newPercent > 1e-9) {
        await tx.insert(liabilityOwners).values({
          liabilityId,
          familyMemberId: o.familyMemberId,
          entityId: null,
          percent: newPercent.toString(),
        });
      }
    } else if (o.entityId != null && o.entityId !== recipientEntityId) {
      await tx.insert(liabilityOwners).values({
        liabilityId,
        familyMemberId: null,
        entityId: o.entityId,
        percent: o.percent,
      });
    }
  }

  const existingRecipient = owners.find((o) => o.entityId === recipientEntityId);
  const finalPercent = percent + (existingRecipient ? Number(existingRecipient.percent) : 0);

  await tx.insert(liabilityOwners).values({
    liabilityId,
    familyMemberId: null,
    entityId: recipientEntityId,
    percent: finalPercent.toString(),
  });
}
