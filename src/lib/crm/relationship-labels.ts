// Pure vocabulary + direction helpers for CRM household↔household links.
// One canonical row is stored per link (see crmHouseholdRelationships in
// schema.ts); every consumer renders its own side via these maps.
// No DB or Next imports — fully unit-testable.

export type CrmHouseholdRelationshipType =
  | "child"
  | "sibling"
  | "spouse"
  | "ex_spouse"
  | "business_partner"
  | "referral_source"
  | "other";

export type ViewerSide = "from" | "to";

export const CRM_HOUSEHOLD_RELATIONSHIP_TYPES = [
  "child",
  "sibling",
  "spouse",
  "ex_spouse",
  "business_partner",
  "referral_source",
  "other",
] as const satisfies readonly CrmHouseholdRelationshipType[];

// Canonical meanings for the two directional types:
//   child           → `from` is the child of `to`
//   referral_source → `from` referred `to`
// The rest are symmetric; storage order carries no meaning (the pair-unique
// index is direction-agnostic anyway).
type LabelPair = { onFromPage: string; onToPage: string };

const LABELS: Record<CrmHouseholdRelationshipType, LabelPair> = {
  child: { onFromPage: "Parent", onToPage: "Child" },
  sibling: { onFromPage: "Sibling", onToPage: "Sibling" },
  spouse: { onFromPage: "Spouse", onToPage: "Spouse" },
  ex_spouse: { onFromPage: "Ex-spouse", onToPage: "Ex-spouse" },
  business_partner: { onFromPage: "Business partner", onToPage: "Business partner" },
  referral_source: { onFromPage: "Referred household", onToPage: "Referred by" },
  other: { onFromPage: "Related", onToPage: "Related" },
};

/** Chip label for the counterpart household, as seen from the viewer's side. */
export function counterpartLabel(
  type: CrmHouseholdRelationshipType,
  viewerSide: ViewerSide,
): string {
  return viewerSide === "from" ? LABELS[type].onFromPage : LABELS[type].onToPage;
}

export type RelationshipPickerOption = {
  value: string; // `${type}:${viewerSide}` — unique per option
  type: CrmHouseholdRelationshipType;
  viewerSide: ViewerSide;
  label: string; // phrased from the current household's perspective
};

// Directional types get both phrasings; symmetric types store as
// viewerSide "from" (arbitrary — the pair index ignores order).
export const RELATIONSHIP_PICKER_OPTIONS: RelationshipPickerOption[] = [
  { value: "child:from", type: "child", viewerSide: "from", label: "This household is the child of the selected household" },
  { value: "child:to", type: "child", viewerSide: "to", label: "This household is the parent of the selected household" },
  { value: "sibling:from", type: "sibling", viewerSide: "from", label: "Sibling households" },
  { value: "spouse:from", type: "spouse", viewerSide: "from", label: "Spouse households" },
  { value: "ex_spouse:from", type: "ex_spouse", viewerSide: "from", label: "Ex-spouse households" },
  { value: "business_partner:from", type: "business_partner", viewerSide: "from", label: "Business partners" },
  { value: "referral_source:from", type: "referral_source", viewerSide: "from", label: "This household referred the selected household" },
  { value: "referral_source:to", type: "referral_source", viewerSide: "to", label: "This household was referred by the selected household" },
  { value: "other:from", type: "other", viewerSide: "from", label: "Other relationship" },
];

/** Resolve which household lands in each canonical column. */
export function toCanonicalColumns(input: {
  viewerSide: ViewerSide;
  viewerHouseholdId: string;
  counterpartHouseholdId: string;
}): { fromHouseholdId: string; toHouseholdId: string } {
  return input.viewerSide === "from"
    ? { fromHouseholdId: input.viewerHouseholdId, toHouseholdId: input.counterpartHouseholdId }
    : { fromHouseholdId: input.counterpartHouseholdId, toHouseholdId: input.viewerHouseholdId };
}
