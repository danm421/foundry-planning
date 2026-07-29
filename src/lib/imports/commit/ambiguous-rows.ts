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

  const count = source.rows(payload).filter((r) => r.match?.kind === "fuzzy").length;
  if (count === 0) return result;

  const subject =
    count === 1 ? `1 ${source.noun} row was` : `${count} ${source.noun} rows were`;
  const matches = count === 1 ? "its match" : "their matches";
  result.warnings.push(
    `${subject} left ambiguous and not imported — resolve ${matches} in the review step and re-commit.`,
  );
  return result;
}
