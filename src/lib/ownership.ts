/**
 * Shared ownership validation helpers used by account and liability API routes.
 *
 * `src/engine/ownership.ts` exists separately — that module is pure projection-time
 * predicates (framework-free). This module is HTTP-route-time validation against the
 * DB and may import Drizzle / Next.js helpers.
 */
import { db } from "@/db";
import { familyMembers, entities } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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
