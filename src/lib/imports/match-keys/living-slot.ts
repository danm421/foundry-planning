import type { ExtractedExpense } from "@/lib/extraction/types";
import type { YearRef } from "@/lib/milestones";
import type { MatchAnnotation } from "../types";

export interface LivingSlot {
  id: string;
  name: string;
  role: "current" | "retirement";
}

/** Classify a seeded living-expense slot by its start milestone. */
export function livingSlotRole(
  startYearRef: YearRef | null,
): "current" | "retirement" | null {
  if (startYearRef === "plan_start") return "current";
  if (startYearRef === "client_retirement" || startYearRef === "spouse_retirement") {
    return "retirement";
  }
  return null;
}

const RETIREMENT_RE = /retirement/i;
/**
 * A "Pre-Retirement" / "Non-Retirement" phase mentions retirement but is not the
 * retirement slot, so it must not auto-fill it (it falls through to the generic
 * matcher; the advisor can still re-link it via the review dropdown).
 */
const NON_RETIREMENT_PREFIX_RE = /\b(?:pre|non)[-\s]?retirement/i;
const RETIREMENT_QUALIFIER_RE = /(expense|budget|living|income|need|spend)/i;
const CURRENT_RE =
  /(living expenses?|monthly expenses?|total expenses?|annual expenses?|household (budget|expenses)|current (living|expenses))/i;

/**
 * When an extracted expense reads like a living-expense TOTAL, link it to the
 * persistent Current/Retirement slot. Returns null for itemized categories
 * (Housing, Groceries…) and non-living rows so the caller falls back to the
 * generic name matcher. Retirement is tested first because a "Retirement Living
 * Expenses" line also matches the current pattern.
 */
export function matchLivingSlot(
  incoming: ExtractedExpense,
  slots: LivingSlot[],
): MatchAnnotation | null {
  if (incoming.type !== "living") return null;
  const name = incoming.name?.trim() ?? "";
  if (!name) return null;

  const isRetirement =
    RETIREMENT_RE.test(name) &&
    !NON_RETIREMENT_PREFIX_RE.test(name) &&
    RETIREMENT_QUALIFIER_RE.test(name);
  const isCurrent = !RETIREMENT_RE.test(name) && CURRENT_RE.test(name);
  const wantRole = isRetirement ? "retirement" : isCurrent ? "current" : null;
  if (!wantRole) return null;

  const slot = slots.find((s) => s.role === wantRole);
  return slot ? { kind: "exact", existingId: slot.id } : null;
}
