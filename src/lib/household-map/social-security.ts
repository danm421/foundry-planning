// src/lib/household-map/social-security.ts
//
// Social Security's display + editability rules for the Household Map. Split out
// of `map-items.ts` because SS is the one cash-flow row whose card cannot be
// derived from the persisted columns alone: its start/end years are inert and
// its editor is a different dialog from every other flow's.
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import { birthYearFromDob } from "@/lib/age-year";
import type { ClientInfo, Income } from "@/engine/types";
import type { FlowStartNote } from "./types";

/** The one type discriminant. Written once so the several places that branch on
 *  it cannot drift onto a stringly-typed comparison that silently stops matching
 *  if the enum member is ever renamed. */
export function isSocialSecurityIncome(income: Pick<Income, "type">): boolean {
  return income.type === "social_security";
}

/** The owner's DOB for an SS row — the SPOUSE's for a spouse-owned benefit.
 *  Same side-selection `resolveClaimAgeMonths` makes, and it has to agree with
 *  it or the claim age and the year it lands in describe two different people. */
function ownerDob(row: Income, client: ClientInfo): string | undefined {
  return row.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
}

/** "70" or "67y 6mo" — whole years read as an age, partial ones have to say so. */
function ageLabel(claimAgeMonths: number): string {
  const years = Math.floor(claimAgeMonths / 12);
  const months = claimAgeMonths % 12;
  return months === 0 ? `${years}` : `${years}y ${months}mo`;
}

/**
 * What the Cash Flow board's timing cell shows for a Social Security row, or
 * null to fall back to the ordinary year range.
 *
 * An SS row's persisted `startYear`/`endYear` are INERT. `social-security-dialog.tsx`
 * writes `startYear` once (whatever year the row was first created) and a flat
 * `endYear: 2099`, and the projection reads neither: `resolveAnnualBenefit`
 * (`engine/socialSecurity/orchestrator.ts`) pays a benefit in the first year the
 * owner's age reaches the resolved CLAIM age. So the "2024-2099" the cell used to
 * show named neither the year the money starts nor anything an advisor chose —
 * the claim age is both.
 *
 * Three answers, in the order they're decided:
 *
 *   "no benefit" — `ssBenefitMode: "no_benefit"`. `engine/income.ts` skips the row
 *                  outright, so an age here would promise money that is never
 *                  paid. Checked FIRST: such a row still carries a perfectly
 *                  resolvable claim age.
 *   "at 70"      — the benefit has not started by `planStartYear`.
 *   null         — it is already in payment, or the claim age is unresolvable
 *                  (no DOB in `fra` mode, no retirement age in `at_retirement`),
 *                  which is also the case where the engine pays nothing. Once a
 *                  benefit IS being paid the window is a fact rather than a
 *                  plan, and the range is the honest label for it.
 *
 * `planStartYear` — not `new Date().getFullYear()`. The projection has no
 * wall-clock input; it runs from the persisted plan start, so a card keyed off
 * today's date would disagree with the numbers beside it.
 */
export function ssStartNote(
  row: Income,
  client: ClientInfo,
  planStartYear: number,
): FlowStartNote | null {
  if (!isSocialSecurityIncome(row)) return null;
  if (row.ssBenefitMode === "no_benefit") {
    return {
      label: "no benefit",
      title: "Set to No Benefit — this Social Security row pays nothing in the projection.",
    };
  }

  const claimAgeMonths = resolveClaimAgeMonths(row, client);
  if (claimAgeMonths == null) return null;

  const birthYear = birthYearFromDob(ownerDob(row, client));
  if (birthYear == null) return null;

  // The engine's own rule, restated: `hasClaimed` is `(year - birthYear) * 12 >=
  // claimAgeMonths`, so the first paying year is the birth year plus the claim
  // age rounded UP to whole years. A 67y-6mo claim first pays at 68.
  const firstBenefitYear = birthYear + Math.ceil(claimAgeMonths / 12);
  if (firstBenefitYear <= planStartYear) return null;

  const age = ageLabel(claimAgeMonths);
  return {
    label: `at ${age}`,
    title: `Benefit starts at age ${age} (${firstBenefitYear})`,
  };
}
