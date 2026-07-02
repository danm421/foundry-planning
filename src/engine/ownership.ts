import type { GiftEvent } from "./types";

export type AccountOwner =
  | { kind: "family_member"; familyMemberId: string; percent: number }
  | { kind: "entity"; entityId: string; percent: number }
  | { kind: "external_beneficiary"; externalBeneficiaryId: string; percent: number }
  | {
      kind: "gifted_away";
      recipient: {
        kind: "entity" | "family_member" | "external_beneficiary";
        id: string;
      };
      percent: number;
    };

/** Ownership row for a business entity (sourced from the `entity_owners`
 *  table). Polymorphic: an owner is either a household family member or
 *  another entity (e.g. a trust that holds the business). Mirrors
 *  `AccountOwner` but excludes `external_beneficiary` — death-benefit
 *  recipients don't hold present interest in a business. */
export type EntityOwner =
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

/** Resolve the owner row a non-household asset/liability gift slice becomes:
 *  a modeled entity owner for trust recipients, else an out-of-estate
 *  gifted_away owner carrying the person/charity recipient ref. */
function recipientOwnerRow(
  e: { recipientEntityId?: string; recipientFamilyMemberId?: string; recipientExternalBeneficiaryId?: string },
  percent: number,
): Extract<AccountOwner, { kind: "entity" | "gifted_away" }> {
  if (e.recipientEntityId) return { kind: "entity", entityId: e.recipientEntityId, percent };
  if (e.recipientFamilyMemberId)
    return { kind: "gifted_away", recipient: { kind: "family_member", id: e.recipientFamilyMemberId }, percent };
  if (e.recipientExternalBeneficiaryId)
    return { kind: "gifted_away", recipient: { kind: "external_beneficiary", id: e.recipientExternalBeneficiaryId }, percent };
  throw new Error("gift event has no recipient");
}

/** Legacy synthetic family-member ids used only when normalizing pre-Phase-2
 *  ClientData (test fixtures) that hasn't populated `owners[]`. The id values
 *  themselves are opaque — the engine never looks them up against the
 *  `familyMembers` list; they only need to be distinct so per-family-member
 *  pro-rating produces sensible household totals. Production data from the
 *  loader bypasses this entirely. */
export const LEGACY_FM_CLIENT = "__legacy_fm_client";
export const LEGACY_FM_SPOUSE = "__legacy_fm_spouse";

/** Sentinel owner id for education_savings (529) accounts. These accounts have
 *  no account_owners rows; the loader synthesizes a single external_beneficiary
 *  owner with this opaque id. external_beneficiary weighs 0 in BOTH
 *  inEstateWeight and outOfEstateWeight, so every ownership-driven aggregation
 *  excludes 529s without per-consumer special cases. Never looked up. */
export const EDUCATION_529_SENTINEL_OWNER_ID = "__529_beneficiary";

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

export function ownedByExternalBeneficiary(
  a: OwnedThing,
  externalBeneficiaryId: string,
): number {
  const row = a.owners.find(
    (o) => o.kind === "external_beneficiary" &&
      o.externalBeneficiaryId === externalBeneficiaryId,
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

    // Add or merge the recipient row (entity for trusts, gifted_away for people).
    const row = recipientOwnerRow(e, e.percent);
    if (row.kind === "entity") {
      const existing = owners.findIndex((o) => o.kind === "entity" && o.entityId === row.entityId);
      if (existing >= 0) {
        owners[existing] = { ...owners[existing], percent: owners[existing].percent + e.percent };
      } else {
        owners.push(row);
      }
    } else {
      const existing = owners.findIndex(
        (o) => o.kind === "gifted_away" && o.recipient.kind === row.recipient.kind && o.recipient.id === row.recipient.id,
      );
      if (existing >= 0) {
        owners[existing] = { ...owners[existing], percent: owners[existing].percent + e.percent };
      } else {
        owners.push(row);
      }
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

/** Stable key for an owner's identity: (kind, owner-id). Percent is excluded so
 *  re-saves that don't change ownership produce a byte-identical owners array. */
function ownerSortKey(o: AccountOwner): string {
  switch (o.kind) {
    case "family_member":
      return `family_member:${o.familyMemberId}`;
    case "entity":
      return `entity:${o.entityId}`;
    case "external_beneficiary":
      return `external_beneficiary:${o.externalBeneficiaryId}`;
    case "gifted_away":
      // Computed (never-stored) owner from a lifetime asset gift. Keyed by its
      // recipient ref so two gifted_away rows sort deterministically.
      return `gifted_away:${o.recipient.kind}:${o.recipient.id}`;
  }
}

/** Deterministic ordering for an owner list so the same owners always serialize
 *  identically across separate DB loads (the `account_owners` query has no
 *  ORDER BY, so physical row order can differ between two executions — for
 *  joint accounts that flips the array and shows up as a phantom `owners` diff
 *  in scenario changes). Pure; returns a new array. */
export function sortOwners<T extends AccountOwner>(owners: readonly T[]): T[] {
  return [...owners].sort((a, b) => ownerSortKey(a).localeCompare(ownerSortKey(b)));
}

export type LiabilityOwner = AccountOwner; // structurally identical
export type LiabilityWithOwners = { id: string; owners: LiabilityOwner[] };

export function liabilityOwnersForYear(
  liability: LiabilityWithOwners,
  giftEvents: GiftEvent[],
  year: number,
  projectionStartYear: number,
): LiabilityOwner[] {
  let owners: LiabilityOwner[] = liability.owners.map((o) => ({ ...o }));

  const events = giftEvents
    .filter(
      (e) =>
        e.kind === "liability" &&
        e.liabilityId === liability.id &&
        e.year >= projectionStartYear &&
        e.year <= year,
    )
    .sort((a, b) => a.year - b.year) as Array<Extract<GiftEvent, { kind: "liability" }>>;

  for (const e of events) {
    const householdShare = owners
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);

    // Guard against divide-by-zero when household has been fully drained.
    // Without this, a small e.percent (or 0) slips past the overdraw check
    // below and produces NaN downstream.
    if (householdShare <= 1e-9) {
      throw new Error(
        `liabilityOwnersForYear: no household share remaining on liability ${liability.id} at year ${e.year} (requested ${e.percent})`,
      );
    }

    if (e.percent > householdShare + 1e-9) {
      throw new Error(
        `liabilityOwnersForYear: would overdraw household share on liability ${liability.id} at year ${e.year} (requested ${e.percent}, available ${householdShare})`,
      );
    }

    const factor = (householdShare - e.percent) / householdShare;
    owners = owners.map((o) =>
      o.kind === "family_member" ? { ...o, percent: o.percent * factor } : o,
    );
    owners = owners.filter((o) => o.kind !== "family_member" || o.percent > 1e-9);
    // Add or merge the recipient row (entity for trusts, gifted_away for people).
    const row = recipientOwnerRow(e, e.percent);
    if (row.kind === "entity") {
      const existing = owners.findIndex((o) => o.kind === "entity" && o.entityId === row.entityId);
      if (existing >= 0) {
        owners[existing] = { ...owners[existing], percent: owners[existing].percent + e.percent };
      } else {
        owners.push(row);
      }
    } else {
      const existing = owners.findIndex(
        (o) => o.kind === "gifted_away" && o.recipient.kind === row.recipient.kind && o.recipient.id === row.recipient.id,
      );
      if (existing >= 0) {
        owners[existing] = { ...owners[existing], percent: owners[existing].percent + e.percent };
      } else {
        owners.push(row);
      }
    }
  }

  const total = owners.reduce((s, o) => s + o.percent, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(
      `liabilityOwnersForYear: composed owners for liability ${liability.id} at year ${year} sum to ${total}, expected 1`,
    );
  }
  return owners;
}

export function liabilityOwnedByEntityAtYear(
  liability: LiabilityWithOwners,
  events: GiftEvent[],
  entityId: string,
  year: number,
  projectionStartYear: number,
): number {
  return liabilityOwnersForYear(liability, events, year, projectionStartYear)
    .filter((o) => o.kind === "entity" && o.entityId === entityId)
    .reduce((s, o) => s + o.percent, 0);
}

export function liabilityOwnedByHouseholdAtYear(
  liability: LiabilityWithOwners,
  events: GiftEvent[],
  year: number,
  projectionStartYear: number,
): number {
  return liabilityOwnersForYear(liability, events, year, projectionStartYear)
    .filter((o) => o.kind === "family_member")
    .reduce((s, o) => s + o.percent, 0);
}

/** Compute the new owners[] after an entity disposes of fraction `f` (0 < f ≤ 1)
 *  of its current `p`-percent ownership of an account or liability. Non-entity
 *  owners' dollar exposure is preserved; their percents scale up against the
 *  reduced post-sale balance.
 *
 *  Math: entity new percent = p(1−f)/(1−fp); others scale by 1/(1−fp).
 *  Edge case: f=1 ∧ p=1 returns []; the caller removes the row entirely.
 *
 *  Used by the entity-sale cascade in asset-transactions.ts. */
export function rebalanceOwnersAfterEntityDisposition(
  owners: AccountOwner[],
  entityId: string,
  f: number,
): AccountOwner[] {
  if (f <= 0 || f > 1) {
    throw new Error(
      `rebalanceOwnersAfterEntityDisposition: f must be in (0, 1], got ${f}`,
    );
  }
  const entityRow = owners.find(
    (o) => o.kind === "entity" && o.entityId === entityId,
  );
  if (!entityRow) {
    throw new Error(
      `rebalanceOwnersAfterEntityDisposition: entity ${entityId} not in owners list`,
    );
  }
  const p = entityRow.percent;
  const denom = 1 - f * p;

  // Full liquidation of sole-entity ownership: caller removes the row.
  if (denom <= 1e-9) return [];

  const result: AccountOwner[] = [];
  for (const o of owners) {
    if (o.kind === "entity" && o.entityId === entityId) {
      const newPercent = (p * (1 - f)) / denom;
      if (newPercent > 1e-9) {
        result.push({ ...o, percent: newPercent });
      }
      continue;
    }
    result.push({ ...o, percent: o.percent / denom });
  }
  return result;
}
