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
 * rules below are its primary consumers, and they have to agree on which
 * amounts count as spending at all — see `livingRowAmount`, which is the one
 * place that decision is made.
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
  return slotIdsWithRole(payload, "retirement");
}

/** Ids of the seeded living slots carrying `role`. One filter, both roles. */
function slotIdsWithRole(
  payload: Pick<ImportPayload, "expenseSlots">,
  role: "current" | "retirement",
): ReadonlySet<string> {
  return new Set((payload.expenseSlots ?? []).filter((s) => s.role === role).map((s) => s.id));
}

/**
 * The advisor linked this row to one of the given seeded living slots — the
 * strongest statement there is about which phase the row describes, because it
 * is the advisor's own, made in the review wizard.
 *
 * One copy, read for BOTH roles by the two-bucket split below. A second copy
 * that drifts is precisely what double-counted living spending the first time.
 */
function isLinkedToSlot(
  row: Annotated<ExtractedExpense>,
  slotIds: ReadonlySet<string>,
): boolean {
  const existingId = getExistingId(row);
  return existingId != null && slotIds.has(existingId);
}

/**
 * The amount this row contributes to a living total, or null when it does not
 * contribute at all.
 *
 * THE single definition of "counts as living spending", read by
 * `sumExtractedLivingByRole`, which decides what the advisor reviews. A second
 * copy of this test would let a future widening apply to one side and not the
 * other, which is how spending goes missing.
 *
 * The fold in `commitExpenses` is deliberately WIDER: it suppresses every
 * `type: "living"` row, including one this test rejects for a zero or absent
 * amount. That is safe in exactly one direction — a row this test rejects
 * carries no money to lose — and it is why the fold can key on the type alone
 * without importing this predicate.
 *
 * Known, deliberate edge: a row with NO `type` is not counted here, and
 * `commitExpenses` writes it as a separate `"other"` expense row. That leaves
 * it outside the reviewed totals — an under-report of the reviewed figure,
 * never a double count. Widening this would silently change the figures the
 * advisor reviews, which is a separate (already-accepted) decision.
 */
function livingRowAmount(row: Annotated<ExtractedExpense>): number | null {
  if (row.type !== "living") return null;
  return numericAmount(row.annualAmount);
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
 * AN EXPLICIT LINK WINS, IN BOTH DIRECTIONS. The review wizard offers both
 * slots as link targets for every expense row, so the link is the advisor's own
 * statement about the row's phase and it outranks any guess made from the name:
 * linked to Retirement → retirement, linked to Current → current EVEN IF the
 * name reads as retirement. Only an unlinked row is classified by name, via
 * `matchLivingSlot`. Letting a retirement-sounding name override a link to
 * Current would make that dropdown a dead control — the advisor moves the row
 * and the money does not move with it.
 *
 * A bucket with no contributing rows is `null`, not a zero: "nothing was
 * extracted" has to stay distinguishable from "$0 was extracted" so the caller
 * can fall through its cascade instead of publishing a fabricated zero.
 */
export function sumExtractedLivingByRole(
  payload: Pick<ImportPayload, "expenses" | "expenseSlots">,
): { current: LivingBucket | null; retirement: LivingBucket | null } {
  const retirementSlotIds = retirementSlotIdsFromPayload(payload);
  const currentSlotIds = slotIdsWithRole(payload, "current");
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
    const amount = livingRowAmount(row);
    if (amount == null) continue;

    // `matchLivingSlot` reads the NAME only — it never looks at `row.match` —
    // so the advisor's link has to be applied here, on top of it, in both
    // directions.
    const slotMatch = matchLivingSlot(row, slots);
    const namedRetirement =
      slotMatch?.kind === "exact" && retirementSlotIds.has(slotMatch.existingId);

    const isRetirement =
      isLinkedToSlot(row, retirementSlotIds) ||
      (!isLinkedToSlot(row, currentSlotIds) && namedRetirement);
    const bucket = isRetirement ? acc.retirement : acc.current;
    bucket.total += amount;
    bucket.count += 1;
  }

  return {
    current: acc.current.count > 0 ? acc.current : null,
    retirement: acc.retirement.count > 0 ? acc.retirement : null,
  };
}
