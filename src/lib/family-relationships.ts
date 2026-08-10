// src/lib/family-relationships.ts
//
// Display labels + <select> options for the `family_relationship` enum
// (src/db/schema.ts).
//
// Lives in `lib/` rather than beside a component so the client portal doesn't
// have to import an advisor component to render relationship copy. The list is
// duplicated byte-for-byte in three advisor files today —
// `family-member-dialog.tsx` and `family-view.tsx` both pull in
// `useScenarioWriter`, so importing either would drag the scenario-writer stack
// into the portal bundle; `crm-family-member-form.tsx` would not, but pointing
// the portal at an advisor CRM form makes an edit there able to regress the
// portal. Those three should adopt this module — deliberately not done here, to
// keep a UI reshape from touching advisor surfaces.

export const FAMILY_RELATIONSHIP_LABELS = {
  child: "Child",
  stepchild: "Stepchild",
  grandchild: "Grandchild",
  great_grandchild: "Great-grandchild",
  parent: "Parent",
  grandparent: "Grandparent",
  sibling: "Sibling",
  sibling_in_law: "Sibling-in-law",
  child_in_law: "Son/Daughter-in-law",
  niece_nephew: "Niece/Nephew",
  aunt_uncle: "Aunt/Uncle",
  cousin: "Cousin",
  grand_aunt_uncle: "Grand-aunt/uncle",
  other: "Other",
} as const;

export type FamilyRelationship = keyof typeof FAMILY_RELATIONSHIP_LABELS;

export const FAMILY_RELATIONSHIP_OPTIONS = (
  Object.entries(FAMILY_RELATIONSHIP_LABELS) as [FamilyRelationship, string][]
).map(([value, label]) => ({ value, label }));

/** Falls back to the raw enum value so an enum added ahead of this map still
 *  renders something rather than blanking the row. */
export function familyRelationshipLabel(value: string): string {
  return FAMILY_RELATIONSHIP_LABELS[value as FamilyRelationship] ?? value;
}
