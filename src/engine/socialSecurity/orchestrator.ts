// src/engine/socialSecurity/orchestrator.ts
import type { Income, ClientInfo } from "../types";
import { fraForBirthDate, survivorFraForBirthDate } from "./fra";
import { computeOwnMonthlyBenefit } from "./ownRetirement";
import { computeSpousalMonthlyBenefit, topUp } from "./spousal";
import { computeSurvivorMonthlyBenefit } from "./survivor";
import { AGE_60_MONTHS, AGE_70_MONTHS } from "./constants";

export interface ResolveAnnualBenefitInput {
  row: Income;                 // This spouse's SS income row (pia_at_fra mode)
  spouseRow: Income | null;    // The other spouse's SS income row (any mode, or null for single clients)
  client: ClientInfo;
  year: number;
}

export interface ResolvedBenefit {
  retirement: number;
  spousal: number;
  survivor: number;
  total: number;
}

function birthYear(dob: string): number {
  return parseInt(dob.slice(0, 4), 10);
}

function ownerDob(income: Income, client: ClientInfo): string | undefined {
  return income.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
}

function claimAgeMonthsOf(row: Income): number {
  return (row.claimingAge ?? 0) * 12 + (row.claimingAgeMonths ?? 0);
}

/**
 * Compute the annualized Social Security benefit for `row` (one spouse's SS
 * income record) in a given projection `year`, integrating own-retirement,
 * spousal, and survivor math across alive/dead and claimed/not-yet-claimed
 * branches.
 *
 * Three high-level cases are resolved in priority order:
 *
 * **Case 1 — Other spouse is dead** (`year >= otherBy + otherLifeExpectancy`):
 *   - If survivor is below age 60: zero benefit.
 *   - Otherwise compute `computeSurvivorMonthlyBenefit` using the deceased's
 *     filing state (never filed / filed before FRA / filed at or after FRA).
 *   - If the survivor has also claimed their own retirement benefit, SSA pays
 *     `max(own, survivor)` with retirement-first decomposition:
 *     `retirement = own`, `survivor = max(0, survivor − own)`.
 *
 * **Case 2 — Both alive and other spouse has claimed**:
 *   - Own benefit via `computeOwnMonthlyBenefit`.
 *   - Spousal benefit via `computeSpousalMonthlyBenefit`.
 *   - Top-up via `topUp(own, spousal)` returns combined total with correct
 *     retirement / spousalPortion breakdown.
 *
 * **Case 3 — Other spouse not yet claimed, or no spouse (single client)**:
 *   - Own benefit only; spousal = 0 (deeming rule requires both to have filed).
 *
 * In all cases the final amounts are multiplied by
 * `growthFactor = (1 + growthRate)^(year − inflationStartYear)` and annualized
 * (`× 12`).
 *
 * @returns `{ retirement, spousal, survivor, total }` — all in annual dollars.
 */
export function resolveAnnualBenefit(input: ResolveAnnualBenefitInput): ResolvedBenefit {
  const zero: ResolvedBenefit = { retirement: 0, spousal: 0, survivor: 0, total: 0 };
  const thisDob = ownerDob(input.row, input.client);
  if (!thisDob) return zero;

  const thisBy = birthYear(thisDob);
  const ageThisYear = input.year - thisBy;
  const ageMonthsThisYear = ageThisYear * 12;
  const thisClaimAgeMonths = claimAgeMonthsOf(input.row);
  const hasClaimed = ageMonthsThisYear >= thisClaimAgeMonths;

  // Determine other spouse state
  const otherDob = input.spouseRow ? ownerDob(input.spouseRow, input.client) : undefined;
  const otherRow = input.spouseRow;
  let otherBy: number | undefined;
  let otherLifeExpectancy: number | undefined;
  let otherIsDead = false;
  let otherHasClaimed = false;

  if (otherRow && otherDob) {
    otherBy = birthYear(otherDob);
    otherLifeExpectancy = input.row.owner === "client"
      ? input.client.spouseLifeExpectancy ?? 95
      : input.client.lifeExpectancy; // client.lifeExpectancy is NOT NULL in DB schema — no fallback needed
    // Death year = otherBy + otherLifeExpectancy. Survivor benefits begin in the death year.
    otherIsDead = otherLifeExpectancy != null && input.year >= otherBy + otherLifeExpectancy;
    const otherClaimAgeMonths = claimAgeMonthsOf(otherRow);
    const otherAgeMonthsThisYear = (input.year - otherBy) * 12;
    otherHasClaimed = otherAgeMonthsThisYear >= otherClaimAgeMonths;
  }

  const growthFactor = Math.pow(1 + input.row.growthRate, input.year - (input.row.inflationStartYear ?? input.row.startYear));
  const annualize = (monthly: number): number => monthly * 12 * growthFactor;

  // ── Case 1: other spouse is dead ─────────────────────────────────
  if (otherIsDead && otherRow && otherBy != null && otherLifeExpectancy != null) {
    if (ageMonthsThisYear < AGE_60_MONTHS) return zero;

    const sFra = survivorFraForBirthDate(thisDob);
    const survivorAgeMonths = Math.min(ageMonthsThisYear, sFra.totalMonths); // no DRC on survivor

    // Determine deceased's filing state at time of death
    const deathYear = otherBy + otherLifeExpectancy;
    const otherClaimYear = otherBy + (otherRow.claimingAge ?? 0);
    const deceasedNeverFiled = deathYear < otherClaimYear;
    const deceasedFra = fraForBirthDate(otherDob!);
    const deceasedAgeAtDeathMonths = (deathYear - otherBy) * 12;
    const deceasedClaimAgeMonths = (otherRow.claimingAge ?? 0) * 12 + (otherRow.claimingAgeMonths ?? 0);
    const deceasedFiledBeforeFra = !deceasedNeverFiled && deceasedClaimAgeMonths < deceasedFra.totalMonths;

    // DRC months: only for Case D (died after FRA, never filed)
    let deceasedDrcMonths = 0;
    if (deceasedNeverFiled && deceasedAgeAtDeathMonths > deceasedFra.totalMonths) {
      deceasedDrcMonths = Math.min(deceasedAgeAtDeathMonths - deceasedFra.totalMonths, AGE_70_MONTHS - deceasedFra.totalMonths);
    }

    // Deceased's reduced benefit (for Case A) or full benefit (for Case B)
    let deceasedReducedBenefit = 0;
    if (otherRow.ssBenefitMode === "pia_at_fra" && otherRow.piaMonthly != null) {
      deceasedReducedBenefit = computeOwnMonthlyBenefit({
        piaMonthly: otherRow.piaMonthly,
        claimAgeMonths: (otherRow.claimingAge ?? 0) * 12 + (otherRow.claimingAgeMonths ?? 0),
        dob: otherDob!,
      });
    }

    const deceasedPia = otherRow.piaMonthly ?? 0;
    const survivor = deceasedPia > 0
      ? computeSurvivorMonthlyBenefit({
          deceasedPiaMonthly: deceasedPia,
          deceasedFiledBeforeFra,
          deceasedReducedBenefit,
          deceasedNeverFiled,
          deceasedDrcMonths,
          survivorAgeMonths,
          survivorDob: thisDob,
        })
      : 0;

    const own = hasClaimed && input.row.piaMonthly != null
      ? computeOwnMonthlyBenefit({
          piaMonthly: input.row.piaMonthly,
          claimAgeMonths: thisClaimAgeMonths,
          dob: thisDob,
        })
      : 0;

    if (own >= survivor) {
      return {
        retirement: annualize(own),
        spousal: 0,
        survivor: 0,
        total: annualize(own),
      };
    }
    return {
      retirement: annualize(own),
      spousal: 0,
      survivor: annualize(survivor - own),
      total: annualize(survivor),
    };
  }

  // ── Case 2: other spouse alive and has claimed ───────────────────
  if (!hasClaimed || input.row.piaMonthly == null) return zero;
  const own = computeOwnMonthlyBenefit({
    piaMonthly: input.row.piaMonthly,
    claimAgeMonths: thisClaimAgeMonths,
    dob: thisDob,
  });
  if (otherRow && otherHasClaimed && otherRow.ssBenefitMode === "pia_at_fra" && otherRow.piaMonthly != null) {
    const spousal = computeSpousalMonthlyBenefit({
      otherPiaMonthly: otherRow.piaMonthly,
      otherSpouseHasClaimed: true,
      claimAgeMonths: thisClaimAgeMonths,
      dob: thisDob,
    });
    const t = topUp(own, spousal);
    return {
      retirement: annualize(t.retirement),
      spousal: annualize(t.spousalPortion),
      survivor: 0,
      total: annualize(t.total),
    };
  }

  // ── Case 3: other spouse not claimed / no spouse → own only ──────
  return {
    retirement: annualize(own),
    spousal: 0,
    survivor: 0,
    total: annualize(own),
  };
}
