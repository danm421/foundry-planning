import type { GiftEvent } from "./types";

export type AccountOwner =
  | { kind: "family_member"; familyMemberId: string; percent: number }
  | { kind: "entity"; entityId: string; percent: number };

/** Minimal account shape used by the year-aware ownership helpers. Structurally
 *  satisfied by the full `Account` type from engine/types. */
export interface AccountWithOwners {
  id: string;
  owners: AccountOwner[];
}

export interface OwnedThing {
  owners: AccountOwner[];
}

/** Legacy synthetic family-member ids used only when normalizing pre-Phase-2
 *  ClientData (test fixtures) that hasn't populated `owners[]`. The id values
 *  themselves are opaque — the engine never looks them up against the
 *  `familyMembers` list; they only need to be distinct so per-family-member
 *  pro-rating produces sensible household totals. Production data from the
 *  loader bypasses this entirely. */
export const LEGACY_FM_CLIENT = "__legacy_fm_client";
export const LEGACY_FM_SPOUSE = "__legacy_fm_spouse";

interface LegacyOwnedThing {
  owners?: AccountOwner[];
  owner?: "client" | "spouse" | "joint";
  ownerEntityId?: string;
  ownerFamilyMemberId?: string;
}

/** Returns `owners[]` populated from legacy fields when empty, otherwise the
 *  existing array. Pure — does not mutate the input. Used by the engine
 *  projection entry-point to backfill old-shape ClientData (engine tests with
 *  fixtures that pre-date Phase 2). */
export function normalizeOwners<T extends LegacyOwnedThing>(thing: T): T & { owners: AccountOwner[] } {
  if (thing.owners && thing.owners.length > 0) {
    return thing as T & { owners: AccountOwner[] };
  }
  const derived = deriveOwnersFromLegacy(thing);
  return { ...thing, owners: derived } as T & { owners: AccountOwner[] };
}

function deriveOwnersFromLegacy(thing: LegacyOwnedThing): AccountOwner[] {
  // Precedence matches migration 0055 backfill:
  //   1. ownerEntityId  → entity 100%
  //   2. ownerFamilyMemberId  → that family_member 100%
  //   3. owner enum     → client / spouse / joint(50/50)
  if (thing.ownerEntityId) {
    return [{ kind: "entity", entityId: thing.ownerEntityId, percent: 1 }];
  }
  if (thing.ownerFamilyMemberId) {
    return [{ kind: "family_member", familyMemberId: thing.ownerFamilyMemberId, percent: 1 }];
  }
  switch (thing.owner) {
    case "client":
      return [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
    case "spouse":
      return [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }];
    case "joint":
      return [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ];
    default:
      // Liabilities don't have an `owner` enum. Migration 0055 backfills
      // non-entity liabilities to client 100%. Match that.
      return [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
  }
}

const EPSILON = 0.0001;

export function ownedByHousehold(a: OwnedThing): number {
  return a.owners
    .filter((o) => o.kind === "family_member")
    .reduce((s, o) => s + o.percent, 0);
}

export function ownedByEntity(a: OwnedThing, entityId: string): number {
  const row = a.owners.find((o) => o.kind === "entity" && o.entityId === entityId);
  return row ? row.percent : 0;
}

export function ownedByFamilyMember(a: OwnedThing, familyMemberId: string): number {
  const row = a.owners.find(
    (o) => o.kind === "family_member" && o.familyMemberId === familyMemberId,
  );
  return row ? row.percent : 0;
}

export function isFullyEntityOwned(a: OwnedThing): boolean {
  if (a.owners.length === 0) return false;
  if (!a.owners.every((o) => o.kind === "entity")) return false;
  const total = a.owners.reduce((s, o) => s + o.percent, 0);
  return Math.abs(total - 1) < EPSILON;
}

export function isFullyHouseholdOwned(a: OwnedThing): boolean {
  if (a.owners.length === 0) return false;
  return a.owners.every((o) => o.kind === "family_member");
}

export function controllingFamilyMember(a: OwnedThing): string | null {
  const fmRows = a.owners.filter((o) => o.kind === "family_member");
  if (fmRows.length !== 1) return null;
  if (Math.abs(fmRows[0].percent - 1) > EPSILON) return null;
  if (a.owners.some((o) => o.kind === "entity")) return null;
  return (fmRows[0] as { familyMemberId: string }).familyMemberId;
}

/** Returns the sole entity owner id when the item is 100% entity-owned by a
 *  single entity. Returns null when mixed, household-owned, or empty. This is
 *  the symmetric counterpart to `controllingFamilyMember`. */
export function controllingEntity(a: OwnedThing): string | null {
  const entityRows = a.owners.filter((o) => o.kind === "entity");
  if (entityRows.length !== 1) return null;
  if (Math.abs(entityRows[0].percent - 1) > EPSILON) return null;
  if (a.owners.some((o) => o.kind === "family_member")) return null;
  return (entityRows[0] as { entityId: string }).entityId;
}

/**
 * Compose static account_owners + asset-transfer gift events into the ownership
 * snapshot at a given projection year. Events with year < projectionStartYear are
 * historical and assumed to be already reflected in the static owners.
 */
export function ownersForYear(
  account: AccountWithOwners,
  giftEvents: GiftEvent[],
  year: number,
  projectionStartYear: number,
): AccountOwner[] {
  // Start from a deep clone of static owners so we don't mutate input.
  let owners: AccountOwner[] = account.owners.map((o) => ({ ...o }));

  const events = giftEvents
    .filter(
      (e) =>
        e.kind === "asset" &&
        e.accountId === account.id &&
        e.year >= projectionStartYear &&
        e.year <= year,
    )
    .sort((a, b) => a.year - b.year) as Array<Extract<GiftEvent, { kind: "asset" }>>;

  for (const e of events) {
    const householdShare = owners
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);

    // Guard against divide-by-zero when household has been fully drained.
    // Without this, a small e.percent (or 0) slips past the overdraw check
    // below and produces NaN downstream.
    if (householdShare <= 1e-9) {
      throw new Error(
        `ownersForYear: no household share remaining on account ${account.id} at year ${e.year} (requested ${e.percent})`,
      );
    }

    if (e.percent > householdShare + 1e-9) {
      throw new Error(
        `ownersForYear: gift event would overdraw household share on account ${account.id} at year ${e.year} (requested ${e.percent}, available ${householdShare})`,
      );
    }

    // Shrink each household row proportionally to free e.percent.
    const factor = (householdShare - e.percent) / householdShare;
    owners = owners.map((o) =>
      o.kind === "family_member" ? { ...o, percent: o.percent * factor } : o,
    );

    // Drop any household rows that rounded to ~0.
    owners = owners.filter((o) => o.kind !== "family_member" || o.percent > 1e-9);

    // Add or merge the recipient entity row.
    const existing = owners.findIndex(
      (o) => o.kind === "entity" && o.entityId === e.recipientEntityId,
    );
    if (existing >= 0) {
      owners[existing] = { ...owners[existing], percent: owners[existing].percent + e.percent };
    } else {
      owners.push({ kind: "entity", entityId: e.recipientEntityId, percent: e.percent });
    }
  }

  // Validate sum-to-1 within tolerance.
  const total = owners.reduce((s, o) => s + o.percent, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(
      `ownersForYear: composed owners for account ${account.id} at year ${year} sum to ${total}, expected 1`,
    );
  }

  return owners;
}

export function ownedByEntityAtYear(
  account: AccountWithOwners,
  events: GiftEvent[],
  entityId: string,
  year: number,
  projectionStartYear: number,
): number {
  const owners = ownersForYear(account, events, year, projectionStartYear);
  return owners
    .filter((o) => o.kind === "entity" && o.entityId === entityId)
    .reduce((s, o) => s + o.percent, 0);
}

export function ownedByHouseholdAtYear(
  account: AccountWithOwners,
  events: GiftEvent[],
  year: number,
  projectionStartYear: number,
): number {
  const owners = ownersForYear(account, events, year, projectionStartYear);
  return owners
    .filter((o) => o.kind === "family_member")
    .reduce((s, o) => s + o.percent, 0);
}

export function ownedByFamilyMemberAtYear(
  account: AccountWithOwners,
  events: GiftEvent[],
  familyMemberId: string,
  year: number,
  projectionStartYear: number,
): number {
  const owners = ownersForYear(account, events, year, projectionStartYear);
  return owners
    .filter((o) => o.kind === "family_member" && o.familyMemberId === familyMemberId)
    .reduce((s, o) => s + o.percent, 0);
}
