/**
 * Pure helper: apply an AssetTabOp to an existing owners[] array.
 *
 * This module has NO framework imports — it must stay testable in plain Vitest.
 */

import type { AccountOwner } from "@/engine/ownership";

const EPSILON = 0.0001;

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds fallback FM rows for `freedPct` when there are no existing household
 * rows to proportionally absorb the change. Splits evenly between client and
 * spouse, or gives all to whichever exists. Throws only when no FM at all.
 */
function defaultHouseholdRows(
  freedPct: number,
  ctx: ApplyOpContext,
  otherRows: AccountOwner[] = [],
): AccountOwner[] {
  const { familyMembers } = ctx;
  const clientFm = familyMembers.find((m) => m.role === "client");
  const spouseFm = familyMembers.find((m) => m.role === "spouse");

  if (clientFm && spouseFm) {
    return [
      ...otherRows,
      { kind: "family_member", familyMemberId: clientFm.id, percent: freedPct / 2 },
      { kind: "family_member", familyMemberId: spouseFm.id, percent: freedPct / 2 },
    ];
  }
  if (clientFm) {
    return [...otherRows, { kind: "family_member", familyMemberId: clientFm.id, percent: freedPct }];
  }
  if (spouseFm) {
    return [...otherRows, { kind: "family_member", familyMemberId: spouseFm.id, percent: freedPct }];
  }
  throw new Error("Cannot remove entity owner: no family members available to reassign freed %");
}

export type AssetTabOp =
  | { type: "remove"; assetType: "account" | "liability"; assetId: string }
  | { type: "set-percent"; assetType: "account" | "liability"; assetId: string; percent: number }
  | { type: "add"; assetType: "account" | "liability"; assetId: string; percent: number };

export interface ApplyOpContext {
  entityId: string;
  /** Household family members — used to find client/spouse for fallback reassignment. */
  familyMembers: { id: string; role: "client" | "spouse" | "child" | "other" }[];
}

/**
 * Takes the current `owners[]` of a single account/liability and applies `op`,
 * returning the new `owners[]`. All returned arrays have sum very close to 1.0.
 */
export function applyAssetTabOp(
  currentOwners: AccountOwner[],
  op: AssetTabOp,
  ctx: ApplyOpContext,
): AccountOwner[] {
  switch (op.type) {
    case "remove":
      return opRemove(currentOwners, ctx);
    case "set-percent":
      return opSetPercent(currentOwners, op.percent / 100, ctx);
    case "add":
      return opAdd(currentOwners, op.percent / 100, ctx);
  }
}

// ── remove ────────────────────────────────────────────────────────────────────

function opRemove(owners: AccountOwner[], ctx: ApplyOpContext): AccountOwner[] {
  const { entityId } = ctx;

  // Find this entity's current share
  const entityRow = owners.find((o) => o.kind === "entity" && o.entityId === entityId);
  const freedPct = entityRow ? entityRow.percent : 0;

  // Drop row(s) for this entity
  const remaining = owners.filter((o) => !(o.kind === "entity" && o.entityId === entityId));

  if (Math.abs(freedPct) < EPSILON) {
    // Nothing was owned — just return unchanged (minus the dropped row)
    return remaining;
  }

  // Existing household FM rows
  const fmRows = remaining.filter((o) => o.kind === "family_member") as Extract<
    AccountOwner,
    { kind: "family_member" }
  >[];
  const otherRows = remaining.filter((o) => o.kind !== "family_member");
  const fmSum = fmRows.reduce((s, o) => s + o.percent, 0);

  if (fmRows.length > 0 && fmSum > EPSILON) {
    // Distribute freed % proportionally among existing FM rows
    const newFmRows = fmRows.map((r) => ({
      ...r,
      percent: r.percent + freedPct * (r.percent / fmSum),
    }));
    return [...otherRows, ...newFmRows].filter((r) => r.percent > EPSILON);
  }

  // No existing FM rows (or all at 0%) — split freed % to client + spouse fallback.
  // Zero-pct FM rows are dropped; the fallback synthesizes fresh ones.
  return defaultHouseholdRows(freedPct, ctx, otherRows).filter((r) => r.percent > EPSILON);
}

// ── set-percent ───────────────────────────────────────────────────────────────

function opSetPercent(
  owners: AccountOwner[],
  newPercent: number, // fraction 0-1
  ctx: ApplyOpContext,
): AccountOwner[] {
  const { entityId } = ctx;

  // Current entity row
  const entityRow = owners.find((o) => o.kind === "entity" && o.entityId === entityId);
  const oldPercent = entityRow ? entityRow.percent : 0;
  const delta = newPercent - oldPercent; // positive = growing entity share

  // All non-entity rows (other than this one)
  const others = owners.filter((o) => !(o.kind === "entity" && o.entityId === entityId));
  const othersSum = others.reduce((s, o) => s + o.percent, 0);

  const newEntity: AccountOwner = { kind: "entity", entityId, percent: newPercent };

  if (Math.abs(othersSum) < EPSILON && Math.abs(delta) > EPSILON) {
    // No other rows exist.
    if (newPercent >= 1 - EPSILON) {
      // Setting to 100% — entity is sole owner.
      return [newEntity];
    }
    // Shrinking below 100%: freed % must go to household FM fallback rows.
    const freedPct = 1 - newPercent;
    return defaultHouseholdRows(freedPct, ctx, [newEntity]).filter((r) => r.percent > EPSILON);
  }

  // Scale other rows proportionally to absorb the delta
  const scale = othersSum > EPSILON ? (othersSum - delta) / othersSum : 0;
  const scaledOthers = others.map((o) => ({ ...o, percent: o.percent * scale }));

  return [...scaledOthers, newEntity].filter((r) => r.percent > EPSILON);
}

// ── add ───────────────────────────────────────────────────────────────────────

function opAdd(
  owners: AccountOwner[],
  percent: number, // fraction 0-1
  ctx: ApplyOpContext,
): AccountOwner[] {
  const { entityId } = ctx;

  // Check if entity already has a row
  const existingEntityRow = owners.find((o) => o.kind === "entity" && o.entityId === entityId);
  if (existingEntityRow) {
    // Treat as a set-percent to the new value
    return opSetPercent(owners, percent, ctx);
  }

  // No existing entity row — insert one and shrink others proportionally
  const othersSum = owners.reduce((s, o) => s + o.percent, 0);
  const scale = othersSum > EPSILON ? (othersSum - percent) / othersSum : 0;

  const scaledOthers = owners.map((o) => ({ ...o, percent: o.percent * scale }));
  const entityRow: AccountOwner = { kind: "entity", entityId, percent };

  return [...scaledOthers, entityRow].filter((r) => r.percent > EPSILON);
}
