import type { ExtractedExpense } from "@/lib/extraction/types";

import type { Annotated, ImportPayload } from "./types";

/**
 * Normalize an extracted amount that is typed `number` but is not
 * runtime-guaranteed to be one — the extraction schema
 * (`extraction-schema.ts`) is a loose Zod object that lets raw LLM output
 * (occasionally a numeric string) flow through unchanged. `commit/incomes.ts`
 * defends against the same thing with `Number(row.annualAmount)`.
 *
 * Lives here rather than in `assemble/plan-basics.ts` because the living-row
 * predicate below is its primary consumer and that predicate has to be
 * byte-identical on both sides of the fold (see `isSummedLivingRow`).
 */
export function numericAmount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ids of the seeded RETIREMENT living slots for this import. A row matched to
 * one of them describes retirement-phase spending and must not be summed into
 * the CURRENT figure (F3).
 *
 * Reads `payload.expenseSlots`, which the matching pass populates with each
 * slot's role. A payload persisted before that field carried a role yields an
 * empty set — the pre-F3 behaviour, which under-classifies rather than
 * misclassifies.
 */
export function retirementSlotIdsFromPayload(payload: ImportPayload): ReadonlySet<string> {
  return new Set(
    (payload.expenseSlots ?? []).filter((s) => s.role === "retirement").map((s) => s.id),
  );
}

/**
 * THE rule for "this extracted expense row feeds the reviewed current-living-
 * spending total on the Plan basics step".
 *
 * It is defined exactly once, here, and used from BOTH sides of the fold:
 *   - `sumExtractedLiving` (assemble) adds these rows up into the figure the
 *     advisor reviews, and
 *   - `commitExpenses` suppresses these rows when that figure is committed.
 * A second, drifting copy of this predicate is precisely what double-counted
 * living spending: the seeded slot carried the sum AND every itemized row was
 * inserted alongside it.
 *
 * Known, deliberate edge: `commitExpenses` inserts a row with NO `type` as
 * `"living"` (`row.type ?? "living"`), but such a row is not summed here and
 * so is not suppressed either. That leaves it as a real, separate expense row
 * outside the reviewed total — an under-report of the reviewed figure, never a
 * double count. Widening this predicate would silently change the figure the
 * advisor reviews, which is a separate (already-accepted) decision.
 *
 * `retirementSlotIds` (F3) excludes a row matched to the retirement slot from
 * the CURRENT sum — that row is retirement-phase spending, and summing it here
 * would both inflate the reviewed current figure AND suppress the row when the
 * fold commits, losing it entirely.
 */
export function isSummedLivingRow(
  row: Annotated<ExtractedExpense>,
  retirementSlotIds: ReadonlySet<string>,
): boolean {
  if (row.type !== "living") return false;
  if (numericAmount(row.annualAmount) == null) return false;
  // A row the advisor linked to the retirement slot is retirement-phase
  // spending. Summing it into the current figure inflates what the advisor
  // reviews AND suppresses the row — wrong twice.
  const existingId = row.match?.kind === "exact" ? row.match.existingId : null;
  if (existingId != null && retirementSlotIds.has(existingId)) return false;
  return true;
}

/**
 * Sum every extracted living-expense row. The extraction prompt tags housing,
 * groceries, utilities, transportation, dining, etc. as separate
 * `"living"`-typed rows (see `expense-worksheet.ts`) — taking only the first
 * one silently discards the rest. `count` lets the caller disclose when more
 * than one row was combined.
 */
export function sumExtractedLiving(
  payload: ImportPayload,
): { total: number; count: number } | null {
  const retirementSlotIds = retirementSlotIdsFromPayload(payload);
  let total = 0;
  let count = 0;
  for (const row of payload.expenses) {
    if (!isSummedLivingRow(row, retirementSlotIds)) continue;
    total += numericAmount(row.annualAmount)!;
    count += 1;
  }
  return count > 0 ? { total, count } : null;
}

/**
 * True when the reviewed living-expense total supersedes the itemized detail
 * — i.e. `commitPlanBasics` will write a real number onto the seeded
 * Current Living Expenses slot, so `commitExpenses` must NOT also insert the
 * rows that fed it.
 *
 * This reads the PAYLOAD, not the set of tabs in the current commit request,
 * and that is deliberate: the review wizard commits one tab per click, so
 * `expenses` can be committed before OR after `plan-basics` (and in a separate
 * request entirely). The payload is the same on both, so the fold decision is
 * identical whichever order they run in.
 *
 * Blank stays blank: no `planBasics` block, or a null/cleared value, means the
 * slot keeps its seeded $0 and the itemized rows MUST still be inserted —
 * losing the spending outright is worse than double counting it.
 */
export function livingTotalSupersedesRows(payload: ImportPayload): boolean {
  return payload.planBasics?.currentLivingSpending.value != null;
}
