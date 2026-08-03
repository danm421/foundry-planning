// src/lib/living-slot-order.ts
//
// Display order for the Living Expenses group, shared by the Details cash-flow
// table and the Solver's living-expense levers. Both surfaces list the same
// rows, so the rank lives here rather than being copied into each one.

import { livingSlotRole } from "@/lib/imports/match-keys/living-slot";
import { coerceYearRef } from "@/lib/milestones";

/** The two fields the rank reads. Satisfied by the engine `Expense` and by the
 *  serialized row shape the Details view renders. */
export interface LivingSlotRankable {
  isDefault?: boolean | null;
  startYearRef?: string | null;
}

/**
 * Sort rank that pins the two SEEDED living-expense slots to the top of the
 * Living Expenses group — Current first, Retirement second — whatever order the
 * server returned them in.
 *
 * The role comes from `livingSlotRole` (the row's START MILESTONE), not its
 * name. The seeds are renameable, and a household whose "Current Living
 * Expenses" had been renamed "My Spending" is exactly the case that sorted the
 * current slot BELOW its own retirement row. `livingSlotRole` is the same
 * classifier the importer matches slots with — a second, name-based copy here
 * would drift from it.
 *
 * `isDefault` is part of the rank, not decoration: an advisor-created row that
 * happens to start at plan_start is ordinary detail, not a slot.
 *
 * Everything else shares rank 2, so `sort`'s stability leaves the rest of the
 * group in the order it arrived.
 */
export function livingSlotRank(e: LivingSlotRankable): 0 | 1 | 2 {
  if (!e.isDefault) return 2;
  const role = livingSlotRole(coerceYearRef(e.startYearRef) ?? null);
  if (role === "current") return 0;
  if (role === "retirement") return 1;
  return 2;
}
