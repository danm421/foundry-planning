// src/lib/balance-sheet/attribute.ts
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE, type AccountOwner } from "@/engine/ownership";

export interface ColumnSplit {
  cooper: number;
  sarah: number;
  joint: number;
  ooe: number;
  /** 1 − sum of in-estate-entity owner percents whose dollars were held back
   *  from this row (per spec rule 3). When 1, no parenthetical is shown. */
  representedPct: number;
}

export interface AttributionCtx {
  /** Family-member id whose role is "client". Null when the household has no
   *  matching family-member row (rare; legacy fixtures). */
  clientFamilyMemberId: string | null;
  /** Family-member id whose role is "spouse". Null when there is no spouse. */
  spouseFamilyMemberId: string | null;
  /** Lookup from familyMemberId → role. Covers child / other roles. Owners
   *  whose familyMemberId isn't in this map are treated as `other` (OOE). */
  rolesByFamilyMemberId: Map<string, "client" | "spouse" | "child" | "other">;
  /** Set of entity ids that are in-estate family-owned businesses with a
   *  positive flat `value`. Rule 3 holds back their share from account rows;
   *  the entity itself surfaces on the Business row via
   *  `attributeEntityFlatValue`. */
  inEstateFlatValuedEntityIds: Set<string>;
  /** Titling: which liability/account ids are jtwros or community_property.
   *  Drives rule 2's "whole value to Joint" detection. */
  titlingByItemId: Map<string, "jtwros" | "community_property" | null>;
}

export interface AttributableItem {
  id: string;
  value: number;
  owners: AccountOwner[];
}

const EPSILON = 1e-9;
const HALF_EPSILON = 1e-6;

export function attributeToColumns(
  item: AttributableItem,
  ctx: AttributionCtx,
): ColumnSplit {
  if (isJointTitledClientSpouseHalfHalf(item, ctx)) {
    return { cooper: 0, sarah: 0, joint: item.value, ooe: 0, representedPct: 1 };
  }

  const split: ColumnSplit = { cooper: 0, sarah: 0, joint: 0, ooe: 0, representedPct: 1 };
  for (const owner of item.owners) {
    if (owner.kind !== "family_member") continue;
    const dollars = item.value * owner.percent;
    const role = roleOf(owner.familyMemberId, ctx);
    if (role === "client") split.cooper += dollars;
    else if (role === "spouse") split.sarah += dollars;
    else split.ooe += dollars;
  }
  return split;
}

function roleOf(
  familyMemberId: string,
  ctx: AttributionCtx,
): "client" | "spouse" | "child" | "other" {
  // Legacy fixture ids predate `familyMembers` rows; map them directly.
  if (familyMemberId === LEGACY_FM_CLIENT) return "client";
  if (familyMemberId === LEGACY_FM_SPOUSE) return "spouse";
  return ctx.rolesByFamilyMemberId.get(familyMemberId) ?? "other";
}

function isJointTitledClientSpouseHalfHalf(
  item: AttributableItem,
  ctx: AttributionCtx,
): boolean {
  const titling = ctx.titlingByItemId.get(item.id);
  if (titling !== "jtwros" && titling !== "community_property") return false;
  if (item.owners.length !== 2) return false;

  const roles = item.owners.map((o) =>
    o.kind === "family_member" ? roleOf(o.familyMemberId, ctx) : null,
  );
  const hasClient = roles.includes("client");
  const hasSpouse = roles.includes("spouse");
  if (!hasClient || !hasSpouse) return false;

  return item.owners.every(
    (o) => o.kind === "family_member" && Math.abs(o.percent - 0.5) < HALF_EPSILON,
  );
}

export function attributeEntityFlatValue(
  _entity: { id: string; value: number; owners: { familyMemberId: string; percent: number }[] | undefined },
  _ctx: AttributionCtx,
): ColumnSplit {
  return { cooper: 0, sarah: 0, joint: 0, ooe: 0, representedPct: 1 };
}

export function emptySplit(): ColumnSplit {
  return { cooper: 0, sarah: 0, joint: 0, ooe: 0, representedPct: 1 };
}

export function addSplits(a: ColumnSplit, b: ColumnSplit): ColumnSplit {
  return {
    cooper: a.cooper + b.cooper,
    sarah: a.sarah + b.sarah,
    joint: a.joint + b.joint,
    ooe: a.ooe + b.ooe,
    representedPct: 1, // representedPct is per-row, not summable
  };
}

export const ATTRIBUTE_EPSILON = EPSILON;
