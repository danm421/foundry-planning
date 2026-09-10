import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedPrimaryFamilyMember,
  ExtractedSavings,
  ExtractedSpouseFamilyMember,
  ExtractedWill,
  ExtractionResult,
} from "@/lib/extraction/types";
import type { AssembleGoals, AssemblePlanBasics, AssembleState } from "./assemble/types";
import type { MergeDecision } from "./assemble/decisions";

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
  /** Set when reconciliation judged this row a duplicate measurement of another
   *  row's earnings. The row is KEPT and shown; commitIncomes skips it. */
  reconciliation?: { supersededBy: string; reason: string };
  /**
   * Stable per-import handle. Assigned at merge time (`mergeAcrossFiles`),
   * never reused for a different row. Derived from the row's dedupe key so
   * it is deterministic across a re-merge of the same files — Task 6, C1:
   * a random id would orphan every id already saved to `committedRowIds`
   * the moment the import's files change and the merge re-runs.
   */
  __rowId?: string;
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
  savings: Annotated<ExtractedSavings>[];
  warnings: string[];
  /**
   * Persistent Current/Retirement living-expense slots for this import's
   * scenario, surfaced to the review UI so the expenses tab can offer them as
   * link targets. Set by the matching pass; absent until then.
   *
   * `role` classifies the slot (F3). It is optional because a payload
   * persisted before this field existed has no role on its slots — those
   * degrade to "not retirement", i.e. exactly the pre-F3 behaviour, which is
   * the safe direction.
   */
  expenseSlots?: Array<{ id: string; name: string; role?: "current" | "retirement" }>;
  /** Advisor-edited plan-level values. Round-trips through buildLatestPayload. */
  planBasics?: AssemblePlanBasics;
  /** Advisor-reviewed goals. Round-trips through buildLatestPayload. */
  goals?: AssembleGoals;
};

/**
 * `payloadJson.payload` AS IT SITS ON DISK. Every section is optional: a
 * payload persisted before a section was added carries no key for it.
 * `ImportPayload` is the in-memory contract and is NOT what rest gives you —
 * go through `normalizeImportPayload` to cross that boundary.
 *
 * This alias exists because the same bug reached its THIRD instance in this
 * codebase (`expenseSlots.role`, `goals`, then `savings`): a section is added
 * to `ImportPayload` as REQUIRED, every already-persisted row lacks it, and
 * the first bare `payload.<section>.length` read crashes. Typing the persisted
 * side as `Partial` turns each of those reads into a compile error.
 */
export type PersistedImportPayload = Partial<ImportPayload>;

/**
 * The only legal way from a persisted payload to the in-memory
 * `ImportPayload` contract. Fills every section a pre-existing row may be
 * missing.
 *
 * The per-key coercion below is deliberate, not belt-and-braces noise: a bare
 * double spread copies an explicit `"savings": null` (which a hand-edited or
 * older writer can leave on disk) straight through, and it sidesteps any
 * argument about whether spreading a `Partial` over a complete type still
 * satisfies `ImportPayload`.
 */
export function normalizeImportPayload(
  raw: PersistedImportPayload | null | undefined,
): ImportPayload {
  const base = emptyImportPayload();
  return {
    ...base,
    ...raw,
    dependents: raw?.dependents ?? base.dependents,
    accounts: raw?.accounts ?? base.accounts,
    incomes: raw?.incomes ?? base.incomes,
    expenses: raw?.expenses ?? base.expenses,
    liabilities: raw?.liabilities ?? base.liabilities,
    lifePolicies: raw?.lifePolicies ?? base.lifePolicies,
    wills: raw?.wills ?? base.wills,
    entities: raw?.entities ?? base.entities,
    savings: raw?.savings ?? base.savings,
    warnings: raw?.warnings ?? base.warnings,
  };
}

/**
 * One exchange in the statement-chat transcript (Task 8+). Discriminated on
 * `role` so a renderer can exhaustively switch without a runtime schema.
 */
export type ChatTurn =
  | { role: "user"; text: string; at: string }
  | { role: "assistant"; text: string; at: string }
  | { role: "tool"; tool: string; summary: string; at: string };

/**
 * Persisted state for the statement-chat import surface (Task 8+).
 *
 * Declared here rather than in `src/lib/statement-chat/state.ts` (R55):
 * `ImportPayloadJson` below needs this type, and `lib/statement-chat` must
 * only ever import FROM `lib/imports`, never the reverse — so typing `chat`
 * as an import from `lib/statement-chat` would close a circular import.
 * `state.ts` imports and re-exports both `ChatTurn` and `ChatState`
 * unchanged, exactly the way `assemble?: AssembleState` above is declared in
 * `./assemble/types` and consumed from `assemble/`.
 */
export interface ChatState {
  /**
   * Literal flag, not an `import_mode` enum value (C7) — adding a value to
   * that enum needs a migration, which this plan's constraints forbid. The
   * drafts list (Task 8) keys its "chat" label off this field alone.
   */
  surface: "chat";
  transcript: ChatTurn[];
  decisions: MergeDecision[];
  /**
   * Wide by design (Ruling 3 / C5), not narrowed to any one producer's
   * shape: Task 4's rollup detector always sets `decision`, but Task 11's
   * advisor-initiated `drop_row` has none, so it must stay optional.
   */
  excludedRows: Array<{ row: Annotated<ExtractedAccount>; reason: string; decision?: MergeDecision }>;
  committedRowIds: string[];
}

/**
 * Shape persisted to `client_imports.payloadJson`. `fileResults` is the
 * source of truth raw per-file extraction; `payload` is the post-merge,
 * post-match shape the review wizard reads. Defined here so the match
 * route, commit route, and commit-time loaders all agree on field names.
 *
 * `payload` is a `PersistedImportPayload`, NOT an `ImportPayload`: what is on
 * disk predates whichever section was added last. Run it through
 * `normalizeImportPayload` before handing it to anything that reads sections
 * unguarded.
 */
export interface ImportPayloadJson {
  fileResults?: Record<string, ExtractionResult>;
  payload?: PersistedImportPayload;
  assemble?: AssembleState;   // NEW — Forge Plan Builder sub-state
  chat?: ChatState;           // NEW — statement-chat surface sub-state (Task 6+)
}

/**
 * Narrow an annotated row to the existingId for the "exact" match kind.
 * Returns null for "fuzzy" or "new" — callers typically skip those rows
 * earlier and treat null as "no canonical id to update".
 */
export function getExistingId<T>(row: Annotated<T>): string | null {
  return row.match?.kind === "exact" ? row.match.existingId : null;
}

/**
 * Record the row → canonical-record link a commit just created, so a later
 * re-commit UPDATEs that record instead of inserting a second copy.
 *
 * Mutates the payload row in place; `commitTabs` persists the whole mutated
 * payload back to `client_imports.payloadJson` inside the same transaction, so
 * the link is only durable if the commit itself commits.
 *
 * Without this the payload keeps saying `{ kind: "new" }` forever and every
 * re-commit duplicates the row — which is exactly what the onboarding drawer's
 * "Apply again" button used to do.
 */
export function linkCreated<T>(row: Annotated<T>, existingId: string): void {
  row.match = { kind: "exact", existingId };
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
    savings: [],
    warnings: [],
  };
}
