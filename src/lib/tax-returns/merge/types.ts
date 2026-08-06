import type { TaxReturnFacts, BusinessFacts, K1Facts } from "@/lib/schemas/tax-return-facts";

export type DocumentRole = "full_return" | "k1" | "w2" | "other";

/** One uploaded document's own extraction. Callers pass these sorted OLDEST
 *  FIRST — scalar precedence among equal-role documents is last-write-wins. */
export interface MergeDocument {
  id: string;
  role: DocumentRole;
  taxYear: number;
  facts: TaxReturnFacts | null;
}

/** Both non-null and different. `winner` is what the merge kept. */
export interface FieldConflict {
  path: string;
  winner: { documentId: string; value: unknown };
  losers: Array<{ documentId: string; value: unknown }>;
}

/** A value the merge refused on structural grounds — a supporting document
 *  trying to write a 1040 aggregate. Distinct from a conflict: nothing was
 *  weighed, the write was never permissible. */
export interface DroppedValue {
  path: string;
  documentId: string;
  value: unknown;
  reason: string;
}

export interface MergeResult {
  facts: TaxReturnFacts;
  /** Field path → the document id that supplied the surviving value. */
  provenance: Record<string, string>;
  conflicts: FieldConflict[];
  dropped: DroppedValue[];
}

/** Sparse advisor edits. Keys are dotted scalar paths ("income.wages") or
 *  entity paths ("k1s[12-3456789].w2WagesFromEntity"). Values are the edited
 *  leaf, never a whole object. */
export type OverrideMap = Record<string, unknown>;

export type EntityCollection = "businesses" | "k1s";
export type MergeEntity = BusinessFacts | K1Facts;
