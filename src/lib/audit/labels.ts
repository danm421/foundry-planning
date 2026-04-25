import type { FieldLabels } from "./types";

/** Labels shared across multiple entity families. Per-entity FIELD_LABELS
 *  spread these in for the fields they actually have. Keeps wording
 *  consistent ("Account value", not "Value" in one place and "Balance" in
 *  another for the same column). */
export const SHARED_FIELD_LABELS = {
  name: { label: "Name", format: "text" },
  ownerEntityId: { label: "Owner entity", format: "reference" },
  ownerFamilyMemberId: { label: "Owner (family)", format: "reference" },
  scenarioId: { label: "Scenario", format: "reference" },
  startYear: { label: "Start year", format: "text" },
  endYear: { label: "End year", format: "text" },
  growthRate: { label: "Growth rate", format: "percent" },
} as const satisfies FieldLabels;

/** Fallback display label for a field key with no explicit FIELD_LABELS entry.
 *  Splits camelCase, replaces `.`/`_` with spaces, capitalizes first letter. */
export function humanizeFieldName(key: string): string {
  return key
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
