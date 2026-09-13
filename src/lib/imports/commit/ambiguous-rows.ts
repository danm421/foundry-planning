import type { ImportPayload, MatchAnnotation } from "../types";
import type { CommitResult, CommitTab } from "./types";

/** The only shape this module reads off a payload row. */
type MatchedRow = { match?: MatchAnnotation };

/**
 * Per-tab source of match-annotated rows, plus the noun used in the warning.
 *
 * Only tabs whose commit module drops a row when `match.kind === "fuzzy"`
 * appear here. `plan-basics` and `clients-identity` write singletons that carry
 * no match annotation, and `goals` is advisor-assembled rather than matched.
 *
 * `savings` is deliberately absent, and adding it would be a bug. Savings rows
 * are never matched: `run-matching.ts` scores only the eight arrays listed
 * above, and `merge-across-files.ts` stamps every savings row
 * `match: { kind: "new" }`. So no savings row can ever be `fuzzy`, and a
 * `savings` entry here could only ever produce a warning claiming rows were
 * "left ambiguous and not imported" for rows that WERE imported.
 */
const AMBIGUOUS_ROW_SOURCES: Partial<
  Record<CommitTab, { noun: string; rows: (p: ImportPayload) => readonly MatchedRow[] }>
> = {
  "family-members": { noun: "family-member", rows: (p) => p.dependents },
  accounts: { noun: "account", rows: (p) => p.accounts },
  incomes: { noun: "income", rows: (p) => p.incomes },
  expenses: { noun: "expense", rows: (p) => p.expenses },
  liabilities: { noun: "liability", rows: (p) => p.liabilities },
  "life-insurance": { noun: "life-insurance", rows: (p) => p.lifePolicies },
  wills: { noun: "will", rows: (p) => p.wills },
  entities: { noun: "entity", rows: (p) => p.entities },
};

/**
 * True when a row will be SKIPPED rather than written, because the matcher
 * could not decide between it and an existing record.
 *
 * The single home for the `fuzzy` → not-written rule that every commit module
 * in `AMBIGUOUS_ROW_SOURCES` applies. Exported so a REVIEW surface can withhold
 * its Commit button instead of POSTing a row that writes nothing and then
 * reporting it as committed — the rule and the warning about the rule now read
 * the same test.
 *
 * Type-only imports keep this module free of any runtime dependency, so a
 * "use client" component can import it.
 */
export function isAmbiguousMatch(row: MatchedRow): boolean {
  return row.match?.kind === "fuzzy";
}

/**
 * Append ONE advisor-facing warning per tab for the rows that tab's commit
 * module left unwritten because the matcher couldn't decide between the
 * incoming row and an existing one (`match.kind === "fuzzy"`).
 *
 * Those rows only ever bumped `CommitResult.skipped`, which nothing renders —
 * so a row the advisor never resolved in the review step silently failed to
 * import. `warnings` is already surfaced by `WarningsBanner`, so routing the
 * summary there makes the outcome visible without a new UI seam.
 *
 * Purely additive reporting: it counts rows off the payload and never touches
 * a commit or skip decision. It deliberately counts ONLY the fuzzy rows —
 * modules also bump `skipped` for unrelated reasons (an `exact` row whose
 * `existingId` went missing, an expense folded into the reviewed living
 * total), and those are not ambiguity and must not be reported as such.
 */
export function noteAmbiguousSkips(
  tab: CommitTab,
  payload: ImportPayload,
  result: CommitResult,
): CommitResult {
  const source = AMBIGUOUS_ROW_SOURCES[tab];
  if (!source) return result;

  const count = source.rows(payload).filter(isAmbiguousMatch).length;
  if (count === 0) return result;

  const subject =
    count === 1 ? `1 ${source.noun} row was` : `${count} ${source.noun} rows were`;
  const matches = count === 1 ? "its match" : "their matches";
  result.warnings.push(
    `${subject} left ambiguous and not imported — resolve ${matches} in the review step and re-commit.`,
  );
  return result;
}
