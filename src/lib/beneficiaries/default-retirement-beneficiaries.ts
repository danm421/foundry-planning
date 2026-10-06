import { splitEvenly } from "@/components/forms/auto-split-percentages";

export interface HouseholdPerson {
  id: string;
  role: "client" | "spouse" | "child" | "other";
  relationship: string;
}

export interface DefaultDesignation {
  tier: "primary" | "contingent";
  percentage: number;
  householdRole: "client" | "spouse" | null;
  familyMemberId: string | null;
  sortOrder: number;
}

/** A new retirement account's beneficiaries: the other co-client as primary,
 *  the children equally as contingent. With no other co-client the children
 *  are primary. Only an account owned by a co-client gets a default.
 *  "Children" are the household's `relationship: "child"` rows, the same set
 *  the Beneficiaries tab's "Split among children" uses. */
export function defaultRetirementBeneficiaries(
  ownerFamilyMemberId: string,
  people: HouseholdPerson[],
): DefaultDesignation[] {
  const owner = people.find((p) => p.id === ownerFamilyMemberId);
  if (owner?.role !== "client" && owner?.role !== "spouse") return [];
  const otherRole: "client" | "spouse" = owner.role === "client" ? "spouse" : "client";
  const hasOther = people.some((p) => p.role === otherRole);
  const children = people.filter(
    (p) => p.role !== "client" && p.role !== "spouse" && p.relationship === "child",
  );
  const pcts = splitEvenly(children.length);
  return [
    ...(hasOther
      ? [{ tier: "primary" as const, percentage: 100, householdRole: otherRole, familyMemberId: null, sortOrder: 0 }]
      : []),
    ...children.map((c, i) => ({
      tier: hasOther ? ("contingent" as const) : ("primary" as const),
      percentage: pcts[i],
      householdRole: null,
      familyMemberId: c.id,
      sortOrder: i,
    })),
  ];
}

type DesignationLike = {
  tier: string;
  /** A decimal string as stored, a number as computed. */
  percentage: number | string;
  householdRole?: string | null;
  familyMemberId?: string | null;
  externalBeneficiaryId?: string | null;
  entityIdRef?: string | null;
};

const designationKey = (r: DesignationLike) =>
  [
    r.tier,
    r.householdRole ?? "",
    r.familyMemberId ?? "",
    r.externalBeneficiaryId ?? "",
    r.entityIdRef ?? "",
    Number(r.percentage).toFixed(2),
  ].join("|");

/** True when `rows` name the same people at the same tiers and shares as
 *  `defaults` — i.e. nobody has edited the default designations. */
export function isDefaultDesignationSet(
  rows: DesignationLike[],
  defaults: DefaultDesignation[],
): boolean {
  const a = rows.map(designationKey).sort();
  const b = defaults.map(designationKey).sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
}
