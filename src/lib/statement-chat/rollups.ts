import type { ExtractedAccount } from "@/lib/extraction/types";
import { normalizeCustodian } from "@/lib/imports/normalize-custodian";
import type { MergeDecision } from "@/lib/imports/assemble/decisions";

/** Same 1% tolerance the cross-file merge uses for "the same figure". */
const TOLERANCE_PCT = 0.01;

/**
 * Labels that mark a row as a total rather than an account. Matched as a
 * substring against the lowercased name, so "Total Plan Analysis" and
 * "Combined Balance — All Accounts" both fire.
 */
const TOTAL_LABELS = [
  "total",
  "all accounts",
  "plan analysis",
  "combined balance",
  "relationship balance",
];

function looksLikeTotal(name: string): boolean {
  const n = name.toLowerCase();
  return TOTAL_LABELS.some((label) => n.includes(label));
}

/**
 * Words that mean a row is a real, individually-held account even though its
 * name also matches `TOTAL_LABELS` — direct mutual-fund statements (Vanguard,
 * Fidelity) name each holding its own account, and fund names routinely
 * start with "Total": "Total Stock Market Index Fund Admiral Shares",
 * "PIMCO Total Return Fund". Checked BEFORE the label test, so it can only
 * ever KEEP a row, never exclude one — it exists to stop the household's
 * single biggest position from being greyed out below the fold.
 */
const ROLLUP_VETO_WORDS = ["fund", "index", "etf", "shares", "stock market", "bond market", "return"];

function isVetoedFromRollup(name: string): boolean {
  const n = name.toLowerCase();
  return ROLLUP_VETO_WORDS.some((word) => n.includes(word));
}

/**
 * Canonical wording for why a detected rollup was excluded. Exported so the
 * ONE place that has to backfill this sentence from a bare `rollup-excluded`
 * `MergeDecision` (the accounts table's defensive normalizer, for an input
 * that carries a decision but no `reason` of its own) reuses this instead of
 * rebuilding the string a third time — see excluded-rows.tsx's review note
 * (Task 10 review, Important 4/5) on why that generic component must never
 * do this derivation itself.
 */
export function rollupExclusionReason(coversCount: number): string {
  return `a total covering ${coversCount} accounts already listed`;
}

function withinTolerance(a: number, b: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return true;
  return Math.abs(a - b) / base <= TOLERANCE_PCT;
}

/**
 * True when `value` is what a total row sitting above `siblings` would show:
 * either it reconciles with their sum, or it simply exceeds the largest of
 * them (statements often print a "Total" that doesn't foot exactly).
 */
function looksLikeTotalOf(value: number, siblings: ReadonlyArray<{ value?: number }>): boolean {
  const siblingSum = siblings.reduce((sum, r) => sum + (r.value as number), 0);
  const largestSibling = Math.max(...siblings.map((r) => r.value as number));
  return withinTolerance(value, siblingSum) || value > largestSibling;
}

export interface RollupResult<T extends ExtractedAccount = ExtractedAccount> {
  kept: T[];
  excluded: Array<{
    row: T;
    /** Plain-text fallback for when no structured `decision` narration exists. */
    reason: string;
    decision: Extract<MergeDecision, { kind: "rollup-excluded" }>;
  }>;
}

/**
 * Separate genuine accounts from the totals statements print alongside them.
 *
 * Rows are grouped by normalized custodian first, so a Capital One total
 * never reconciles against Schwab balances, and two rows with no readable
 * custodian (an absent one, or one that's nothing but a legal suffix like
 * "LLC") land in the same catch-all bucket and CAN be compared to each
 * other.
 *
 * A row is a rollup only when ALL of these hold:
 *   1. its name does not contain a fund/ETF word (`ROLLUP_VETO_WORDS`) — a
 *      real fund holding can be named "Total Return Fund" and must never be
 *      classified as a rollup no matter what the other two rules say, AND
 *   2. it carries a total-ish label ("Total", "All Accounts", ...), AND
 *   3. among its same-custodian siblings, either its value reconciles with
 *      their sum, or it exceeds every one of them.
 *
 * The label is a NECESSARY condition, not just a tiebreaker — it's what
 * keeps a coincidental sum (or the shared "no custodian" bucket) from
 * silently swallowing a real account. A rollup is never DELETED — the
 * caller renders it greyed with the reason and an "include anyway" toggle.
 * Committing one would double-count the household's net worth; hiding one
 * without saying so would be worse. When a judgment call is close, the
 * function keeps the row.
 */
export function detectRollups<T extends ExtractedAccount>(rows: T[]): RollupResult<T> {
  const kept: T[] = [];
  const excluded: RollupResult<T>["excluded"] = [];

  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = normalizeCustodian(row.custodian) ?? "__unknown__";
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  // Walk `rows` in ORIGINAL order (not group order) so output order never
  // depends on how many custodians are present — the groups map above is
  // only used to look up each row's siblings.
  for (const row of rows) {
    const key = normalizeCustodian(row.custodian) ?? "__unknown__";
    const siblings = groups.get(key)!.filter((r) => r !== row && typeof r.value === "number");

    const isRollup =
      siblings.length >= 2 &&
      typeof row.value === "number" &&
      !isVetoedFromRollup(row.name) &&
      looksLikeTotal(row.name) &&
      looksLikeTotalOf(row.value, siblings);

    if (!isRollup) {
      kept.push(row);
      continue;
    }

    excluded.push({
      row,
      reason: rollupExclusionReason(siblings.length),
      decision: {
        kind: "rollup-excluded",
        label: row.name,
        value: row.value as number,
        coversCount: siblings.length,
      },
    });
  }

  return { kept, excluded };
}
