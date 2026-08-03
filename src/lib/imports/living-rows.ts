import type { ExtractedExpense } from "@/lib/extraction/types";

import { matchLivingSlot } from "./match-keys/living-slot";
import { getExistingId, type Annotated, type ImportPayload } from "./types";

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
export function retirementSlotIdsFromPayload(
  payload: Pick<ImportPayload, "expenseSlots">,
): ReadonlySet<string> {
  return new Set(
    (payload.expenseSlots ?? []).filter((s) => s.role === "retirement").map((s) => s.id),
  );
}

/**
 * The advisor linked this row to a seeded RETIREMENT living slot — the
 * strongest statement there is about which phase the row describes.
 *
 * One copy, read by both the current-side predicate below and the two-bucket
 * split further down. A second copy that drifts is precisely what
 * double-counted living spending the first time.
 */
function isLinkedToRetirementSlot(
  row: Annotated<ExtractedExpense>,
  retirementSlotIds: ReadonlySet<string>,
): boolean {
  const existingId = getExistingId(row);
  return existingId != null && retirementSlotIds.has(existingId);
}

/**
 * THE rule for "this extracted expense row feeds the reviewed current-living-
 * spending total on the Plan basics step".
 *
 * It is defined exactly once, here, and read by `commitExpenses`, which
 * suppresses exactly these rows when the reviewed figure is committed. The
 * assemble side's `sumExtractedLivingByRole` no longer routes through this
 * predicate — it needs three answers (current / retirement / neither) where
 * this one gives two — but both go through `isLinkedToRetirementSlot` above so
 * the retirement rule itself stays single-sourced. A second, drifting copy of
 * that rule is precisely what double-counted living spending: the seeded slot
 * carried the sum AND every itemized row was inserted alongside it.
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
  return !isLinkedToRetirementSlot(row, retirementSlotIds);
}

/** One bucket's reviewed figure. `count` lets the caller disclose a combination. */
export interface LivingBucket {
  total: number;
  count: number;
}

/**
 * Split every extracted living-expense row into the two buckets the plan
 * actually has. The extraction prompt tags housing, groceries, utilities,
 * transportation, dining, etc. as separate `"living"` rows (see
 * `expense-worksheet.ts`), and there is nowhere for them to land individually
 * any more — `type: "living"` is a closed two-row set (a Current row and a
 * Retirement row), so every extracted row has to join one total or the other.
 *
 * A row is RETIREMENT-side when the advisor linked it to the retirement slot
 * (checked first — an explicit link always wins) or when `matchLivingSlot`
 * reads its name as retirement. Everything else is CURRENT-side.
 *
 * A bucket with no contributing rows is `null`, not a zero: "nothing was
 * extracted" has to stay distinguishable from "$0 was extracted" so the caller
 * can fall through its cascade instead of publishing a fabricated zero.
 */
export function sumExtractedLivingByRole(
  payload: Pick<ImportPayload, "expenses" | "expenseSlots">,
): { current: LivingBucket | null; retirement: LivingBucket | null } {
  const retirementSlotIds = retirementSlotIdsFromPayload(payload);
  // `matchLivingSlot` needs a resolved role per slot. A payload persisted
  // before slots carried one degrades to "current", so no slot answers a
  // retirement lookup and every row lands in the current bucket — the same
  // under-classify-don't-misclassify stance as `retirementSlotIdsFromPayload`.
  const slots = (payload.expenseSlots ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role ?? ("current" as const),
  }));
  const acc = {
    current: { total: 0, count: 0 },
    retirement: { total: 0, count: 0 },
  };

  for (const row of payload.expenses) {
    if (row.type !== "living") continue;
    const amount = numericAmount(row.annualAmount);
    if (amount == null) continue;

    const slotMatch = matchLivingSlot(row, slots);
    const namedRetirement =
      slotMatch?.kind === "exact" && retirementSlotIds.has(slotMatch.existingId);

    const isRetirement =
      isLinkedToRetirementSlot(row, retirementSlotIds) || namedRetirement;
    const bucket = isRetirement ? acc.retirement : acc.current;
    bucket.total += amount;
    bucket.count += 1;
  }

  return {
    current: acc.current.count > 0 ? acc.current : null,
    retirement: acc.retirement.count > 0 ? acc.retirement : null,
  };
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
 *
 * DELETE WITH TASK 5. Its only caller is `commit/expenses.ts`, which Task 5
 * rewrites to stop inserting living rows at all — at which point the fold, and
 * this predicate, have nothing left to decide. Kept here only so this commit
 * builds.
 */
export function livingTotalSupersedesRows(payload: ImportPayload): boolean {
  return payload.planBasics?.currentLivingSpending.value != null;
}
