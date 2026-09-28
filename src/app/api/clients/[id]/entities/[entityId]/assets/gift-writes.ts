/**
 * Plans the DB writes for adding or removing a trust's interest in a business.
 *
 * THE GIFT PATH WRITES NO OWNER ROWS. `entity_owners` is the AUTHORED,
 * pre-gift baseline; gifts are an overlay that `entityOwnersForYear` re-applies
 * on every read. This route used to delete and reinsert the whole owners table
 * for the business — destroying the baseline, making "what did the advisor
 * actually enter" unanswerable, and dating the transfer to the current calendar
 * year instead of the gift year.
 *
 * `ownerRowsToWrite` is non-null ONLY for a direct, non-gift ownership edit.
 *
 * Pure: no DB, no clock. The route loads the inputs and applies the plan.
 */

import { entityOwnersForYear, type AccountOwner, type EntityOwner } from "@/engine/ownership";
import type { GiftEvent } from "@/engine/types";
import { applyEntityOwnersOp, EPSILON } from "@/lib/entity-owners-ops";

/** A recorded `business_interest` gift row of this business. */
export interface ExistingBusinessGift {
  id: string;
  year: number;
  percent: number;
  recipientEntityId: string;
  grantor: "client" | "spouse";
}

export interface EntityGiftWritesInput {
  businessId: string;
  /** The business's flat value. A gift row's `amount` is this × its percent. */
  businessValue: number;
  /** The business's AUTHORED `entity_owners` rows — the pre-gift baseline. */
  authoredOwners: EntityOwner[];
  /** The household roster: who may be a §709 grantor, and where a released
   *  authored share falls back to when no family row is left to absorb it. */
  householdMembers: { id: string; role: "client" | "spouse" | "child" | "other" }[];
  /** Every recorded `business_interest` gift of this business, any recipient. */
  existingGifts: ExistingBusinessGift[];
  /** The base plan's first projection year. The engine reads a gift dated
   *  before it as already folded into the authored owners — and a gift writes
   *  no owner rows — so an earlier gift year is refused. */
  planStartYear: number;
  op:
    | {
        op: "add";
        trustId: string;
        trustIsIrrevocable: boolean;
        /** A FRACTION (0.3 = 30%). */
        percent: number;
        year: number;
        valuationDiscount?: number | null;
      }
    | { op: "remove"; trustId: string };
}

/** A `gifts` row to insert, less `clientId` (the route adds it). */
export interface BusinessGiftRow {
  year: number;
  amount: string;
  grantor: "client" | "spouse";
  recipientEntityId: string;
  businessEntityId: string;
  percent: string;
  valuationDiscount: string | null;
  eventKind: "outright";
}

export interface EntityGiftWritesPlan {
  /** Replaces the business's `entity_owners` rows; null leaves them untouched. */
  ownerRowsToWrite: EntityOwner[] | null;
  giftRows: BusinessGiftRow[];
  giftRowIdsToDelete: string[];
  /** The share that moved to the trust (0 for a remove). */
  appliedDebit: number;
  /** Set when the op is refused; nothing else is written. */
  error?: string;
}

const NO_SHARE = "No share available to assign to trust";

/** `entity_owners.percent` and `gifts.percent` are numeric(6,4): whole basis
 *  points of the business. Every percent the plan writes is split and checked
 *  in these units, so what is checked is exactly what is stored. */
const BP = 10_000;
const toBp = (fraction: number): number => Math.round(fraction * BP);
const fmtBp = (bp: number): string => `${(bp / 100).toFixed(2)}%`;

function refuse(error: string): EntityGiftWritesPlan {
  return { ownerRowsToWrite: null, giftRows: [], giftRowIdsToDelete: [], appliedDebit: 0, error };
}

export function planEntityGiftWrites(input: EntityGiftWritesInput): EntityGiftWritesPlan {
  const { op } = input;
  if (op.op === "remove") return planRemove(input, op.trustId);
  return op.trustIsIrrevocable ? planGift(input, op) : planAuthoredAdd(input, op);
}

type AddOp = Extract<EntityGiftWritesInput["op"], { op: "add" }>;
type HouseholdRow = Extract<AccountOwner, { kind: "family_member" }>;

/**
 * The household's owner rows once EVERY recorded gift has left them, or null
 * when the recorded gifts already overdraw the household.
 *
 * Resolved with no projection window — projectionStartYear 0 and no upper year —
 * so every gift counts at write time, whatever its date. The engine composes a
 * business's gifts in year order and throws on one that overdraws what is left,
 * so a new gift dated BEFORE an existing one must still leave room for it; the
 * share at the new gift's own year would miss that.
 */
function householdAfterGifts(
  businessId: string,
  owners: EntityOwner[],
  gifts: ExistingBusinessGift[],
): HouseholdRow[] | null {
  const events: GiftEvent[] = gifts.map((g) => ({
    kind: "business_interest",
    entityId: businessId,
    year: g.year,
    percent: g.percent,
    grantor: g.grantor,
    recipientEntityId: g.recipientEntityId,
  }));
  try {
    return entityOwnersForYear({ id: businessId, owners }, events, Number.MAX_SAFE_INTEGER, 0)
      .filter((o): o is HouseholdRow => o.kind === "family_member");
  } catch {
    // The resolver throws only when the gifts overdraw the household share.
    return null;
  }
}

/** Split `totalBp` across `weights` in whole basis points, largest remainder
 *  first, so the parts sum to exactly `totalBp` — per-part rounding can write
 *  rows that sum past the request, which the engine reads as an overdraw once
 *  nothing else is left. */
function splitBp(totalBp: number, weights: number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (totalBp * w) / weightSum);
  const parts = exact.map(Math.floor);
  let left = totalBp - parts.reduce((s, p) => s + p, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, remainder: e - parts[i] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/** A gift of a business interest to an irrevocable trust: gift rows only. */
function planGift(input: EntityGiftWritesInput, op: AddOp): EntityGiftWritesPlan {
  if (op.year < input.planStartYear) {
    return refuse(
      `The gift year (${op.year}) is before the plan start year (${input.planStartYear})`,
    );
  }
  const household = householdAfterGifts(input.businessId, input.authoredOwners, input.existingGifts);
  if (household === null) {
    return refuse("This business's recorded gifts already exceed the household share");
  }
  const requestedBp = toBp(op.percent);
  const availableBp = toBp(household.reduce((s, o) => s + o.percent, 0));
  if (requestedBp === 0) return refuse(NO_SHARE);
  if (requestedBp > availableBp) {
    return refuse(
      `Gift exceeds the household share of this business: ${fmtBp(requestedBp)} requested, ${fmtBp(availableBp)} available`,
    );
  }

  // One row per household member's loss, pro-rata — the overlay draws a gift
  // from every household row in proportion to its share. Only a client or
  // spouse can be a §709 grantor (the gifts.grantor enum), so a child's or other
  // member's slice gets no row — the same rows this route has always written.
  const losses = splitBp(requestedBp, household.map((o) => o.percent));
  const giftRows: BusinessGiftRow[] = [];
  let appliedBp = 0;
  household.forEach((owner, i) => {
    const role = input.householdMembers.find((m) => m.id === owner.familyMemberId)?.role;
    if ((role !== "client" && role !== "spouse") || losses[i] === 0) return;
    appliedBp += losses[i];
    const lost = losses[i] / BP;
    giftRows.push({
      year: op.year,
      // FULL undiscounted value. The normalizer values this gift from `amount`
      // (as amountOverride, which wins over `entityValueAtYear`) and applies
      // `valuationDiscount` to it there. Pre-multiplying here would
      // double-discount.
      amount: (input.businessValue * lost).toFixed(2),
      grantor: role,
      recipientEntityId: op.trustId,
      // The loader builds the ownership overlay only from rows naming the
      // business; without it the gift would move no ownership at all.
      businessEntityId: input.businessId,
      percent: lost.toFixed(4),
      valuationDiscount: op.valuationDiscount != null ? op.valuationDiscount.toFixed(4) : null,
      eventKind: "outright",
    });
  });
  if (giftRows.length === 0) return refuse(NO_SHARE);

  return { ownerRowsToWrite: null, giftRows, giftRowIdsToDelete: [], appliedDebit: appliedBp / BP };
}

/** Rounded to what `entity_owners.percent` stores. */
function toStoredOwners(owners: EntityOwner[]): EntityOwner[] {
  return owners.map((o) => ({ ...o, percent: toBp(o.percent) / BP }));
}

/** Assigning a share to a REVOCABLE trust is not a gift — the grantor keeps
 *  control — so it is an authored retitle of the owner rows, as before. */
function planAuthoredAdd(input: EntityGiftWritesInput, op: AddOp): EntityGiftWritesPlan {
  const result = applyEntityOwnersOp(input.authoredOwners, {
    type: "add",
    trustId: op.trustId,
    percent: op.percent,
  });
  if (result.appliedDebit < EPSILON) return refuse(NO_SHARE);
  const ownerRowsToWrite = toStoredOwners(result.newOwners);
  // The retitle shrinks the household's authored share, and the overlay still
  // draws every recorded gift from it: leaving too little would throw every
  // projection of this client.
  if (householdAfterGifts(input.businessId, ownerRowsToWrite, input.existingGifts) === null) {
    return refuse("Not enough household share would be left for this business's recorded gifts");
  }
  return { ownerRowsToWrite, giftRows: [], giftRowIdsToDelete: [], appliedDebit: result.appliedDebit };
}

/**
 * Undo either way the trust came to hold the business: delete its gift rows
 * (a gifted interest), and release its authored row (a retitled one) back to
 * the household. A trust can hold both — rows this route wrote before it stopped
 * rewriting `entity_owners` carry the gift AND the rewritten owner row.
 */
function planRemove(input: EntityGiftWritesInput, trustId: string): EntityGiftWritesPlan {
  const giftRowIdsToDelete = input.existingGifts
    .filter((g) => g.recipientEntityId === trustId)
    .map((g) => g.id);
  const holdsAuthoredRow = input.authoredOwners.some(
    (o) => o.kind === "entity" && o.entityId === trustId,
  );
  if (!holdsAuthoredRow && giftRowIdsToDelete.length === 0) {
    return refuse("Trust does not own this business");
  }
  const ownerRowsToWrite = holdsAuthoredRow
    ? toStoredOwners(
        applyEntityOwnersOp(
          input.authoredOwners,
          { type: "remove", trustId },
          { familyMembers: input.householdMembers },
        ).newOwners,
      )
    : null;
  return { ownerRowsToWrite, giftRows: [], giftRowIdsToDelete, appliedDebit: 0 };
}
