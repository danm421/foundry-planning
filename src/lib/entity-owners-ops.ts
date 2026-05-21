/**
 * Pure helper: apply an entity-owners mutation when a business entity (LLC,
 * S-Corp, C-Corp, partnership, other) is assigned to / removed from / repercented
 * against a trust.
 *
 * This module mirrors `src/components/forms/asset-tab-ops.ts` but operates on
 * the polymorphic `EntityOwner[]` shape (family_member | entity) used by the
 * `entity_owners` join table. No framework imports — must stay testable in
 * plain Vitest.
 *
 * Algorithm for `add` (the primary op this module supports today):
 *
 *   1. If a row already exists for the target trust, treat the op as a
 *      `set-percent` to (existing trust pct + delta).
 *   2. Otherwise, scale all existing owner rows proportionally by
 *      `(othersSum - delta) / othersSum` so the total stays at `othersSum`
 *      (≤ 1.0), then add a new trust row at `delta`.
 *   3. Track per-family-member loss as `oldPercent - newPercent` so the
 *      caller can emit per-grantor gift rows.
 *
 * The trust's "gain" is capped at the available family share (`othersSum`) —
 * we never let the total exceed 1.0. If the caller requests more than is
 * available, we cap and report the actual debit via `appliedDebit`.
 */

import type { EntityOwner } from "@/engine/ownership";

export const EPSILON = 0.0001;

export type EntityOwnersOp =
  | { type: "add"; trustId: string; percent: number /* fraction 0-1 */ }
  | { type: "remove"; trustId: string }
  | { type: "set-percent"; trustId: string; percent: number /* fraction 0-1 */ };

export interface ApplyEntityOwnersOpResult {
  newOwners: EntityOwner[];
  /** Family-member-only losses, in case the caller wants gift events. */
  familyLosses: { familyMemberId: string; lost: number }[];
  /** Total amount the trust actually absorbed in this op. May be less than
   *  the requested percent if family share was insufficient. */
  appliedDebit: number;
}

/** Optional context for ops that need household fallback (e.g. `remove` when
 *  no existing family-member rows exist to absorb the freed share). */
export interface ApplyEntityOwnersOpContext {
  familyMembers: { id: string; role: "client" | "spouse" | "child" | "other" }[];
}

function sumPct(owners: EntityOwner[]): number {
  return owners.reduce((s, o) => s + o.percent, 0);
}

/**
 * Takes the current `owners[]` of a business entity and applies `op`,
 * returning the new `owners[]` + per-owner loss data.
 *
 * Loss is reported only for rows that EXISTED in `currentOwners` (i.e. the
 * family members who were on the cap table before the op).
 */
export function applyEntityOwnersOp(
  currentOwners: EntityOwner[],
  op: EntityOwnersOp,
  ctx?: ApplyEntityOwnersOpContext,
): ApplyEntityOwnersOpResult {
  switch (op.type) {
    case "add":
      return opAdd(currentOwners, op.trustId, op.percent);
    case "set-percent":
      return opSetPercent(currentOwners, op.trustId, op.percent);
    case "remove":
      return opRemove(currentOwners, op.trustId, ctx);
  }
}

// ── add ───────────────────────────────────────────────────────────────────────

function opAdd(
  owners: EntityOwner[],
  trustId: string,
  percent: number,
): ApplyEntityOwnersOpResult {
  // If trust already owns part of the business, treat as a set-percent to
  // (existing trust pct + delta). Same as the asset-tab-ops behavior.
  const existingTrustRow = owners.find(
    (o) => o.kind === "entity" && o.entityId === trustId,
  );
  if (existingTrustRow) {
    return opSetPercent(owners, trustId, existingTrustRow.percent + percent);
  }

  // No existing trust row — scale others to absorb the new row.
  const others = owners;
  const othersSum = sumPct(others);

  // Cap debit at available share — never let the total exceed 1.0.
  const debit = Math.min(percent, othersSum);
  if (debit <= EPSILON) {
    return { newOwners: owners, familyLosses: [], appliedDebit: 0 };
  }

  const scale = othersSum > EPSILON ? (othersSum - debit) / othersSum : 0;
  const scaledOthers: EntityOwner[] = others.map((o) => ({
    ...o,
    percent: o.percent * scale,
  }));

  const trustRow: EntityOwner = {
    kind: "entity",
    entityId: trustId,
    percent: debit,
  };
  const newOwners: EntityOwner[] = [...scaledOthers, trustRow].filter(
    (r) => r.percent > EPSILON,
  );

  const familyLosses = computeFamilyLosses(owners, scaledOthers);

  return { newOwners, familyLosses, appliedDebit: debit };
}

// ── set-percent ───────────────────────────────────────────────────────────────

function opSetPercent(
  owners: EntityOwner[],
  trustId: string,
  newPercent: number,
): ApplyEntityOwnersOpResult {
  const entityRow = owners.find(
    (o) => o.kind === "entity" && o.entityId === trustId,
  );
  const oldPercent = entityRow ? entityRow.percent : 0;

  // Clamp the trust's new percent to [0, 1].
  const clampedNewPercent = Math.max(0, Math.min(1, newPercent));

  // All rows other than the trust row.
  const others = owners.filter(
    (o) => !(o.kind === "entity" && o.entityId === trustId),
  );
  const othersSum = sumPct(others);

  // Don't let the trust grow beyond `oldPercent + othersSum` — cap at the
  // share actually available.
  const cappedTarget = Math.min(clampedNewPercent, oldPercent + othersSum);
  const delta = cappedTarget - oldPercent; // positive = growing trust

  const debit = Math.max(0, delta);

  if (Math.abs(delta) < EPSILON) {
    return { newOwners: owners, familyLosses: [], appliedDebit: 0 };
  }

  // Scale others to absorb the delta. If othersSum is ~0 and delta > 0,
  // there's nothing to scale (caller should fall back to family-default
  // rows — but for this helper, we leave the cap at oldPercent which is
  // the safe interpretation: no gift can be made if no family share exists).
  const scale = othersSum > EPSILON ? (othersSum - delta) / othersSum : 1;
  const scaledOthers: EntityOwner[] = others.map((o) => ({
    ...o,
    percent: o.percent * scale,
  }));

  const trustRow: EntityOwner = {
    kind: "entity",
    entityId: trustId,
    percent: cappedTarget,
  };
  const newOwners: EntityOwner[] = [...scaledOthers, trustRow].filter(
    (r) => r.percent > EPSILON,
  );

  const familyLosses = computeFamilyLosses(owners, scaledOthers);

  return { newOwners, familyLosses, appliedDebit: debit };
}

// ── remove ────────────────────────────────────────────────────────────────────

/** Reassign the trust's share back to family members. If existing FM rows
 *  carry weight, the freed % is distributed proportionally across them; if
 *  none do (e.g. the trust held 100%), it falls back to the household
 *  client/spouse split — same pattern as account/liability removal in
 *  asset-tab-ops.ts. */
function opRemove(
  owners: EntityOwner[],
  trustId: string,
  ctx: ApplyEntityOwnersOpContext | undefined,
): ApplyEntityOwnersOpResult {
  const trustRow = owners.find(
    (o) => o.kind === "entity" && o.entityId === trustId,
  );
  const freedPct = trustRow ? trustRow.percent : 0;

  // Strip the trust's row(s); other owners (including other trusts) stay.
  const remaining = owners.filter(
    (o) => !(o.kind === "entity" && o.entityId === trustId),
  );

  if (Math.abs(freedPct) < EPSILON) {
    return { newOwners: remaining, familyLosses: [], appliedDebit: 0 };
  }

  // Distribute freedPct proportionally across existing FM rows when any have
  // non-zero share. Other entity-owners are left untouched — only family
  // members absorb the released stake.
  const fmRows = remaining.filter((o) => o.kind === "family_member") as Extract<
    EntityOwner,
    { kind: "family_member" }
  >[];
  const nonFmRows = remaining.filter((o) => o.kind !== "family_member");
  const fmSum = fmRows.reduce((s, o) => s + o.percent, 0);

  if (fmRows.length > 0 && fmSum > EPSILON) {
    const grownFm = fmRows.map((r) => ({
      ...r,
      percent: r.percent + freedPct * (r.percent / fmSum),
    }));
    return {
      newOwners: [...nonFmRows, ...grownFm].filter((r) => r.percent > EPSILON),
      familyLosses: [],
      appliedDebit: 0,
    };
  }

  // No existing FM rows — fall back to client (+ spouse if married). Without
  // a household context we can't synthesize one; in that case we drop the
  // trust row and let the caller decide what to do with the orphaned share.
  if (!ctx) {
    return {
      newOwners: nonFmRows.filter((r) => r.percent > EPSILON),
      familyLosses: [],
      appliedDebit: 0,
    };
  }
  const fallback = defaultHouseholdRows(freedPct, ctx);
  return {
    newOwners: [...nonFmRows, ...fallback].filter((r) => r.percent > EPSILON),
    familyLosses: [],
    appliedDebit: 0,
  };
}

function defaultHouseholdRows(
  freedPct: number,
  ctx: ApplyEntityOwnersOpContext,
): EntityOwner[] {
  const { familyMembers } = ctx;
  const clientFm = familyMembers.find((m) => m.role === "client");
  const spouseFm = familyMembers.find((m) => m.role === "spouse");
  if (clientFm && spouseFm) {
    return [
      { kind: "family_member", familyMemberId: clientFm.id, percent: freedPct / 2 },
      { kind: "family_member", familyMemberId: spouseFm.id, percent: freedPct / 2 },
    ];
  }
  if (clientFm) {
    return [{ kind: "family_member", familyMemberId: clientFm.id, percent: freedPct }];
  }
  if (spouseFm) {
    return [{ kind: "family_member", familyMemberId: spouseFm.id, percent: freedPct }];
  }
  return [];
}

// ── shared ────────────────────────────────────────────────────────────────────

/**
 * Diff the original owners against the post-scale owners (which still hold
 * the same row identity — same familyMemberId / entityId) and emit one
 * loss entry per family member whose percent decreased.
 *
 * `scaledOthers` excludes the trust row. Owners that are entity rows other
 * than the trust are intentionally ignored — only family-member losses
 * generate §709 gift events.
 */
function computeFamilyLosses(
  before: EntityOwner[],
  scaledOthers: EntityOwner[],
): { familyMemberId: string; lost: number }[] {
  const losses: { familyMemberId: string; lost: number }[] = [];
  for (const oldRow of before) {
    if (oldRow.kind !== "family_member") continue;
    const newRow = scaledOthers.find(
      (o) => o.kind === "family_member" && o.familyMemberId === oldRow.familyMemberId,
    );
    const newPct = newRow ? newRow.percent : 0;
    const lost = oldRow.percent - newPct;
    if (lost > EPSILON) {
      losses.push({ familyMemberId: oldRow.familyMemberId, lost });
    }
  }
  return losses;
}
