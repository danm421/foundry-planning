// src/engine/socialSecurity/resolvePia.ts
import type { Income, ClientInfo } from "../types";
import { computeOwnMonthlyBenefit } from "./ownRetirement";
import { resolveClaimAgeMonths } from "./claimAge";

/**
 * The age, in total months, a `manual_amount` row's `annualAmount` is quoted
 * at. An explicit stated age wins; NULL means the row's own claim age — what
 * every amount entered before stated ages existed meant, and what a writer
 * that does not know the age (a scenario change, the AI) still means.
 * Anything but a finite number counts as NULL: an unvalidated scenario overlay
 * can leave "" here, and "" * 12 = 0 would price at the earliest payable age.
 */
export function statedAgeMonths(row: Income, client: ClientInfo): number | null {
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (isNum(row.ssStatedAge)) return row.ssStatedAge * 12 + (isNum(row.ssStatedAgeMonths) ? row.ssStatedAgeMonths : 0);
  return resolveClaimAgeMonths(row, client);
}

/**
 * The worker's Primary Insurance Amount, monthly, in today's dollars — the one
 * figure early/late claiming, spousal and survivor math all run off — or null
 * when the row is not priced off a PIA at all.
 *
 *   pia_at_fra           → the stored PIA. 0 is a real answer (no work record:
 *                          own benefit $0, spousal/survivor still apply); an
 *                          unset PIA is null.
 *   manual_amount / NULL → the stated amount divided back out of SSA's
 *                          early-reduction / delayed-credit factor at the age it
 *                          is quoted for. The factor is computeOwnMonthlyBenefit
 *                          itself (entitlement-month pricing, the 70 cap), so an
 *                          amount quoted at the claim age round-trips to exactly
 *                          that amount.
 *   no_benefit, a year-by-year schedule, no DOB, or no resolvable age → null:
 *                          the row is paid as a literal amount.
 */
export function resolvePiaMonthly(row: Income, client: ClientInfo): number | null {
  if (row.type !== "social_security") return null;
  const mode = row.ssBenefitMode ?? "manual_amount";
  if (mode === "no_benefit") return null;
  if (mode === "pia_at_fra") return row.piaMonthly ?? null;
  if (row.scheduleOverrides) return null;
  const dob = row.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
  if (!dob) return null;
  const ageMonths = statedAgeMonths(row, client);
  if (ageMonths == null) return null;
  const factor = computeOwnMonthlyBenefit({ piaMonthly: 1, claimAgeMonths: ageMonths, dob });
  if (!(factor > 0)) return null;
  return row.annualAmount / 12 / factor;
}
