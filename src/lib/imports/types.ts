import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedPrimaryFamilyMember,
  ExtractedSpouseFamilyMember,
  ExtractedWill,
  ExtractionResult,
} from "@/lib/extraction/types";

export type Provenance = {
  sourceFileId: string;
  section: string;
  pageRange?: [number, number];
};

export type MatchAnnotation =
  | { kind: "exact"; existingId: string }
  | { kind: "fuzzy"; candidates: Array<{ id: string; score: number }> }
  | { kind: "new" };

export type MatchKind = MatchAnnotation["kind"];

export type Annotated<T> = T & {
  __provenance?: Provenance;
  match?: MatchAnnotation;
};

/**
 * Unified per-import payload after every uploaded file's extraction has
 * been merged. The match-annotation step (Phase 5) sets `match` on each
 * row; until then rows are emitted with `match: { kind: "new" }`. The
 * commit step (Phase 6) reads this shape to write canonical DB rows.
 *
 * The `primary` and `spouse` slots are singletons because a household can
 * only have one of each. If two extractions disagree, the merge step keeps
 * the first non-empty value and records the conflict in warnings.
 */
export type ImportPayload = {
  primary?: ExtractedPrimaryFamilyMember;
  spouse?: ExtractedSpouseFamilyMember;
  dependents: Annotated<ExtractedDependent>[];
  accounts: Annotated<ExtractedAccount>[];
  incomes: Annotated<ExtractedIncome>[];
  expenses: Annotated<ExtractedExpense>[];
  liabilities: Annotated<ExtractedLiability>[];
  lifePolicies: Annotated<ExtractedLifePolicy>[];
  wills: Annotated<ExtractedWill>[];
  entities: Annotated<ExtractedEntity>[];
  warnings: string[];
};

/**
 * Shape persisted to `client_imports.payloadJson`. `fileResults` is the
 * source of truth raw per-file extraction; `payload` is the post-merge,
 * post-match shape the review wizard reads. Defined here so the match
 * route, commit route, and commit-time loaders all agree on field names.
 */
export interface ImportPayloadJson {
  fileResults?: Record<string, ExtractionResult>;
  payload?: ImportPayload;
}

/**
 * Narrow an annotated row to the existingId for the "exact" match kind.
 * Returns null for "fuzzy" or "new" — callers typically skip those rows
 * earlier and treat null as "no canonical id to update".
 */
export function getExistingId<T>(row: Annotated<T>): string | null {
  return row.match?.kind === "exact" ? row.match.existingId : null;
}

export function emptyImportPayload(): ImportPayload {
  return {
    dependents: [],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    warnings: [],
  };
}
