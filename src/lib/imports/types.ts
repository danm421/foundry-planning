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
