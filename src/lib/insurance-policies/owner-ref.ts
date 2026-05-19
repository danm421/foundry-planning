import type { AccountOwner } from "@/engine/ownership";

/** Discriminated reference to a single life-insurance policy owner. The form
 *  state stores this; the translation helpers convert it to/from the
 *  `account_owners` join table's row shape. */
export type OwnerRef =
  | { kind: "joint" }
  | { kind: "family"; id: string }
  | { kind: "entity"; id: string }
  | { kind: "external"; id: string };

export interface OwnerRefContext {
  clientFmId: string | null;
  spouseFmId: string | null;
}

export interface AccountOwnerRowInsert {
  familyMemberId: string | null;
  entityId: string | null;
  externalBeneficiaryId: string | null;
  /** Decimal-as-string matching the column type (precision 6, scale 4). */
  percent: string;
}

/** Translate an `OwnerRef` into the rows to insert into `account_owners`.
 *  `joint` produces two family rows at 0.5 each; everything else is one row
 *  at 1.0. Missing spouse-FM degrades joint to a single client row at 1.0. */
export function ownerRefToAccountOwnerRows(
  ref: OwnerRef,
  ctx: OwnerRefContext,
): AccountOwnerRowInsert[] {
  if (ref.kind === "joint") {
    if (ctx.clientFmId && ctx.spouseFmId) {
      return [
        { familyMemberId: ctx.clientFmId, entityId: null, externalBeneficiaryId: null, percent: "0.5000" },
        { familyMemberId: ctx.spouseFmId, entityId: null, externalBeneficiaryId: null, percent: "0.5000" },
      ];
    }
    if (ctx.clientFmId) {
      return [
        { familyMemberId: ctx.clientFmId, entityId: null, externalBeneficiaryId: null, percent: "1.0000" },
      ];
    }
    return [];
  }
  if (ref.kind === "family") {
    return [{ familyMemberId: ref.id, entityId: null, externalBeneficiaryId: null, percent: "1.0000" }];
  }
  if (ref.kind === "entity") {
    return [{ familyMemberId: null, entityId: ref.id, externalBeneficiaryId: null, percent: "1.0000" }];
  }
  // ref.kind === "external"
  return [{ familyMemberId: null, entityId: null, externalBeneficiaryId: ref.id, percent: "1.0000" }];
}

const EPS = 0.0001;

/** Derive an `OwnerRef` from a populated `AccountOwner[]`. Mirrors the
 *  shapes produced by `ownerRefToAccountOwnerRows`. Returns null when the
 *  shape doesn't match a recognized ref (mixed ownership, unknown family
 *  member, etc.); callers should treat null as "not editable via OwnerRef
 *  in this UI" — that policy wasn't created through this editor. */
export function ownerRefFromOwners(
  owners: AccountOwner[],
  ctx: OwnerRefContext,
): OwnerRef | null {
  if (owners.length === 0) return null;

  // joint: exactly two family rows totaling ~1, one of each principal
  if (owners.length === 2 && owners.every((o) => o.kind === "family_member")) {
    const fmIds = (owners as Array<{ familyMemberId: string; percent: number }>)
      .map((o) => o.familyMemberId);
    const total = owners.reduce((s, o) => s + o.percent, 0);
    if (
      Math.abs(total - 1) < EPS &&
      ctx.clientFmId && ctx.spouseFmId &&
      fmIds.includes(ctx.clientFmId) && fmIds.includes(ctx.spouseFmId)
    ) {
      return { kind: "joint" };
    }
  }

  // single-row ownership
  if (owners.length === 1) {
    const o = owners[0];
    if (Math.abs(o.percent - 1) > EPS) return null;
    if (o.kind === "family_member") return { kind: "family", id: o.familyMemberId };
    if (o.kind === "entity") return { kind: "entity", id: o.entityId };
    if (o.kind === "external_beneficiary") return { kind: "external", id: o.externalBeneficiaryId };
  }
  return null;
}
