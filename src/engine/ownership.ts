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
  /** See `Account.giftsReflectedThrough`: asset gifts dated at or before it are
   *  already in `owners` (and the account's value), so they do not compose. */
  giftsReflectedThrough?: number;
}

/** True when a gift dated `year` is already baked into this account's rows:
 *  set by a death partition, which routes the pool net of every gift so far. */
function giftAlreadyReflected(account: { giftsReflectedThrough?: number }, year: number): boolean {
  return account.giftsReflectedThrough != null && year <= account.giftsReflectedThrough;
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

/** Shared body of `ownersForYear` and `liabilityOwnersForYear` (and, from the
 *  business-interest work, `entityOwnersForYear`). The three differ ONLY in
 *  which events they select and what noun their errors use, so the composition
 *  rules — proportional household shrink, recipient merge, sum-to-1 validation
 *  — live here once. */
function composeOwnersForYear(
  staticOwners: AccountOwner[],
  events: Array<{ year: number; percent: number } & Parameters<typeof recipientOwnerRow>[0]>,
  year: number,
  fn: string,
  noun: string,
): AccountOwner[] {
  let owners: AccountOwner[] = staticOwners.map((o) => ({ ...o }));
  const sorted = [...events].sort((a, b) => a.year - b.year);

  for (const e of sorted) {
    const householdShare = owners
      .filter((o) => o.kind === "family_member")
      .reduce((s, o) => s + o.percent, 0);

    // Guard against divide-by-zero when household has been fully drained.
    // Without this, a small e.percent (or 0) slips past the overdraw check
    // below and produces NaN downstream.
    if (householdShare <= 1e-9) {
      throw new Error(
        `${fn}: no household share remaining on ${noun} at year ${e.year} (requested ${e.percent})`,
      );
    }
    if (e.percent > householdShare + 1e-9) {
      throw new Error(
        `${fn}: gift event would overdraw household share on ${noun} at year ${e.year} (requested ${e.percent}, available ${householdShare})`,
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
      const i = owners.findIndex((o) => o.kind === "entity" && o.entityId === row.entityId);
      if (i >= 0) owners[i] = { ...owners[i], percent: owners[i].percent + e.percent };
      else owners.push(row);
    } else {
      const i = owners.findIndex(
        (o) =>
          o.kind === "gifted_away" &&
          o.recipient.kind === row.recipient.kind &&
          o.recipient.id === row.recipient.id,
      );
      if (i >= 0) owners[i] = { ...owners[i], percent: owners[i].percent + e.percent };
      else owners.push(row);
    }
  }

  const total = owners.reduce((s, o) => s + o.percent, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(
      `${fn}: composed owners for ${noun} at year ${year} sum to ${total}, expected 1`,
    );
  }
  return owners;
}

/**
 * Compose static account_owners + asset-transfer gift events into the ownership
 * snapshot at a given projection year. Events with year < projectionStartYear are
 * historical and assumed to be already reflected in the static owners — and so
 * are events at or before `account.giftsReflectedThrough`, for a family pool a
 * death partition rebuilt.
 */
export function ownersForYear(
  account: AccountWithOwners,
  giftEvents: GiftEvent[],
  year: number,
  projectionStartYear: number,
): AccountOwner[] {
  const events = giftEvents.filter(
    (e) =>
      e.kind === "asset" &&
      e.accountId === account.id &&
      e.year >= projectionStartYear &&
      e.year <= year &&
      !giftAlreadyReflected(account, e.year),
  ) as Array<Extract<GiftEvent, { kind: "asset" }>>;
  return composeOwnersForYear(
    account.owners, events, year, "ownersForYear", `account ${account.id}`,
  );
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
export type LiabilityWithOwners = {
  id: string;
  owners: LiabilityOwner[];
  /** See `Liability.giftsReflectedThrough`. */
  giftsReflectedThrough?: number;
};

export function liabilityOwnersForYear(
  liability: LiabilityWithOwners,
  giftEvents: GiftEvent[],
  year: number,
  projectionStartYear: number,
): LiabilityOwner[] {
  const events = giftEvents.filter(
    (e) =>
      e.kind === "liability" &&
      e.liabilityId === liability.id &&
      e.year >= projectionStartYear &&
      e.year <= year &&
      !giftAlreadyReflected(liability, e.year),
  ) as Array<Extract<GiftEvent, { kind: "liability" }>>;
  return composeOwnersForYear(
    liability.owners, events, year, "liabilityOwnersForYear", `liability ${liability.id}`,
  );
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

/** One shared aggregate guard for both gift-aware wrappers.
 *
 *  `composeOwnersForYear` draws each gift from the (shrinking) household share
 *  and throws once the cumulative draw exceeds it — so the throw condition is
 *  precisely `Σ giftedPercent > householdShare`. Guarding on the aggregate lets
 *  a wrapper fall back to the static owners without an exception when the gifts
 *  already encode the transfer (e.g. an ILIT policy modeled as entity-owned
 *  with a redundant §2035 event), while still letting a genuine integrity throw
 *  surface for valid-household inputs.
 *
 *  That fallback keeps a DIRECT caller of the death-event functions
 *  (`computeGrossEstate` and its siblings) alive on such a shape — they resolve
 *  owners only through these wrappers. It does not keep `runProjection` alive:
 *  the projection's raw composers throw on the same shape. An account throws at
 *  `computePortfolioSnapshot`, which every account passes through, and — when a
 *  non-grantor trust exists — at `ownedByEntityAtYear` in the trust passes; a
 *  liability with a payment due throws at `liabilityOwnedByHouseholdAtYear`.
 *  An account's ownership snapshot usually reaches this guard first, so the
 *  warning below prints before the throw — unless a linked income on the
 *  property, expanded at the top of `runProjection` before the snapshot is
 *  built, reads it raw first and throws with no warning at all.
 *
 *  The fallback WARNS. It is otherwise indistinguishable from a correct
 *  resolution, and that silence is how a double-applied overlay hides: a caller
 *  that hands us already-overlaid owners plus the raw events lands here every
 *  time and quietly reverts to gift-blind numbers. */
function canFundGifts(
  owners: AccountOwner[],
  giftedPercent: number,
  fn: string,
  noun: string,
  year: number,
): boolean {
  const householdShare = owners
    .filter((o) => o.kind === "family_member")
    .reduce((s, o) => s + o.percent, 0);
  if (giftedPercent > householdShare + 1e-9) {
    console.warn(
      `${fn}: ${noun} at year ${year} has gifts totalling ${giftedPercent} but only ` +
        `${householdShare} household share — falling back to authored owners. If this ` +
        `is not an already-encoded transfer (e.g. an ILIT policy), the caller is ` +
        `passing owners that ALREADY have the overlay applied.`,
    );
    return false;
  }
  return true;
}

/**
 * Year-aware owners for a death-time computation. A lifetime `kind:"asset"`
 * GiftEvent retitles ownership (`ownersForYear`) — a person/charity gift becomes
 * a `gifted_away` owner (out of estate) and an (irrevocable) trust gift becomes
 * an `entity` owner (`deceasedEntityShare` = 0) — so the gifted asset leaves the
 * gross estate. Without this the death path read static `account.owners` and
 * double-counted gifted assets (in the gross estate AND in adjusted taxable
 * gifts).
 *
 * Returns `account.owners` unchanged when gift context is absent (e.g. a unit
 * test calling `computeGrossEstate` bare) or when no in-window asset gift
 * targets this account. The household-share guard (`canFundGifts`) skips
 * retitling when the static owners already encode the transfer (e.g. an
 * ILIT-gifted policy modeled as entity-owned with a redundant gift event for
 * §2035 / ATG) — there `ownersForYear` would over-draw the zero household share
 * and throw. That rescues a direct death-path call, not a projection:
 * `runProjection` still throws on such an account at its raw reads (see
 * `canFundGifts`).
 */
export function giftAwareOwners(
  account: AccountWithOwners,
  giftEvents: GiftEvent[] | undefined,
  deathYear: number | undefined,
  planStartYear: number | undefined,
): AccountOwner[] {
  if (!giftEvents || deathYear == null || planStartYear == null) return account.owners;
  let giftedPercent = 0;
  for (const e of giftEvents) {
    if (e.kind !== "asset") continue;
    if (e.accountId !== account.id) continue;
    if (e.year < planStartYear || e.year > deathYear) continue;
    if (giftAlreadyReflected(account, e.year)) continue;
    giftedPercent += e.percent;
  }
  if (giftedPercent <= 0) return account.owners;
  if (!canFundGifts(account.owners, giftedPercent, "giftAwareOwners", `account ${account.id}`, deathYear)) {
    return account.owners;
  }
  return ownersForYear(account, giftEvents, deathYear, planStartYear);
}

/** Liability twin of {@link giftAwareOwners}.
 *
 *  The `giftedPercent <= 0` early-out is not an optimization here — it is the
 *  whole point. Unlinked household debts routinely carry `owners: []`, and a
 *  bare `liabilityOwnersForYear` on those sums to 0 and throws "expected 1".
 *  Every death-path liability flows through this, so without the early-out the
 *  first unlinked debt takes down the projection.
 *
 *  Every no-gift path (no context, no in-window gift for this id, a zero-percent
 *  gift, a declined gift) returns `liability.owners` BY REFERENCE — and so does a
 *  death-partitioned row whose gifts are all dated at or before its
 *  `giftsReflectedThrough` (they are skipped; when nothing is left, the authored
 *  array comes back). Callers rely on it: `computeGrossEstate` reads `!==` as "a
 *  gift was applied", so a copy on any of these paths would pull ungifted joint
 *  debts off their linked-property / 50-50 defaults. That is why the id / year-window filters below are not redundant with
 *  `liabilityOwnersForYear`'s own — they decide the by-reference early-out as well
 *  as feeding the `canFundGifts` aggregate guard. */
export function giftAwareLiabilityOwners(
  liability: LiabilityWithOwners,
  giftEvents: GiftEvent[] | undefined,
  year: number | undefined,
  planStartYear: number | undefined,
): LiabilityOwner[] {
  if (!giftEvents || year == null || planStartYear == null) return liability.owners;
  let giftedPercent = 0;
  for (const e of giftEvents) {
    if (e.kind !== "liability") continue;
    if (e.liabilityId !== liability.id) continue;
    if (e.year < planStartYear || e.year > year) continue;
    if (giftAlreadyReflected(liability, e.year)) continue;
    giftedPercent += e.percent;
  }
  if (giftedPercent <= 0) return liability.owners;
  if (!canFundGifts(liability.owners, giftedPercent, "giftAwareLiabilityOwners", `liability ${liability.id}`, year)) {
    return liability.owners;
  }
  return liabilityOwnersForYear(liability, giftEvents, year, planStartYear);
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
