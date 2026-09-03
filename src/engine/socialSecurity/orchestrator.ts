// src/engine/socialSecurity/orchestrator.ts
import type { Income, ClientInfo } from "../types";
import { fraForBirthDate, survivorFraForBirthDate } from "./fra";
import { computeOwnMonthlyBenefit } from "./ownRetirement";
import { computeSpousalMonthlyBenefit, topUp } from "./spousal";
import { computeSurvivorMonthlyBenefit } from "./survivor";
import { AGE_60_MONTHS, AGE_70_MONTHS } from "./constants";
import { resolveClaimAgeMonths, resolveEntitlementMonth } from "./claimAge";
import { monthsPaidInYear, type EntitlementMonth } from "./entitlement";

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

/**
 * The later of two entitlement months — the onset of a benefit that requires
 * BOTH spouses to have filed. Null propagates: if either side never claims,
 * the joint benefit never starts.
 */
function laterOf(a: EntitlementMonth | null, b: EntitlementMonth | null): EntitlementMonth | null {
  if (!a || !b) return null;
  const ai = a.year * 12 + a.month;
  const bi = b.year * 12 + b.month;
  return ai >= bi ? a : b;
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
 * `growthFactor = (1 + growthRate)^(year − inflationStartYear)` and annualized.
 *
 * **Annualization is by MONTHS PAID, not a flat × 12.** Entitlement begins in a
 * calendar month, so the year a benefit switches on is worth `13 − month`
 * payments — a December birthday collects one. Each component starts on its own
 * clock: own retirement at this worker's entitlement month, and the spousal
 * top-up at the LATER of the two spouses' entitlement months, because deeming
 * needs both on the rolls. Survivor onset stays year-granular: death is modeled
 * as `birthYear + lifeExpectancy`, which carries no month to prorate against.
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
  const thisClaimAgeMonths = resolveClaimAgeMonths(input.row, input.client);
  if (thisClaimAgeMonths == null) return zero;
  const thisEntitlement = resolveEntitlementMonth(input.row, input.client);
  const ownMonths = monthsPaidInYear(thisEntitlement, input.year);
  const hasClaimed = ownMonths > 0;

  // Determine other spouse state
  const otherDob = input.spouseRow ? ownerDob(input.spouseRow, input.client) : undefined;
  const otherRow = input.spouseRow;
  let otherBy: number | undefined;
  let otherLifeExpectancy: number | undefined;
  let otherIsDead = false;
  let otherHasClaimed = false;
  let otherEntitlement: EntitlementMonth | null = null;

  if (otherRow && otherDob) {
    otherBy = birthYear(otherDob);
    otherLifeExpectancy = input.row.owner === "client"
      ? input.client.spouseLifeExpectancy ?? 95
      : input.client.lifeExpectancy; // client.lifeExpectancy is NOT NULL in DB schema — no fallback needed
    // Death year = otherBy + otherLifeExpectancy is the last alive year (matches
    // applyIncomeTermination and effectiveFilingStatus conventions). Survivor
    // benefits begin the year AFTER the death year; the death year itself still
    // pays the deceased's own benefit via their own SS row.
    otherIsDead = otherLifeExpectancy != null && input.year > otherBy + otherLifeExpectancy;
    otherEntitlement = resolveEntitlementMonth(otherRow, input.client);
    otherHasClaimed = monthsPaidInYear(otherEntitlement, input.year) > 0;
  }

  const growthFactor = Math.pow(1 + input.row.growthRate, input.year - (input.row.inflationStartYear ?? input.row.startYear));
  // `months` is how many of the year's twelve payments this component actually
  // earns. It is 12 in every steady-state year and less only in the year a
  // benefit switches on, which is the whole point of resolving entitlement to
  // a month rather than a year.
  const annualize = (monthly: number, months: number): number => monthly * months * growthFactor;

  // ── Case 1: other spouse is dead ─────────────────────────────────
  if (otherIsDead && otherRow && otherBy != null && otherLifeExpectancy != null) {
    if (ageMonthsThisYear < AGE_60_MONTHS) return zero;

    const sFra = survivorFraForBirthDate(thisDob);
    const survivorAgeMonths = Math.min(ageMonthsThisYear, sFra.totalMonths); // no DRC on survivor

    // Determine deceased's filing state at time of death
    const deathYear = otherBy + otherLifeExpectancy;
    const deceasedClaimAgeMonths = resolveClaimAgeMonths(otherRow, input.client) ?? 0;
    const deceasedClaimYear = otherBy + deceasedClaimAgeMonths / 12;
    const deceasedNeverFiled = deathYear < deceasedClaimYear;
    const deceasedFra = fraForBirthDate(otherDob!);
    const deceasedAgeAtDeathMonths = (deathYear - otherBy) * 12;
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
        claimAgeMonths: deceasedClaimAgeMonths,
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

    // The survivor benefit runs the whole year (death is modeled at year
    // granularity, so there is no death month to prorate against), but the
    // survivor's OWN retirement can switch on mid-year. Split the year at that
    // month: before it SSA pays the survivor benefit alone; from it onward SSA
    // pays max(own, survivor), decomposed retirement-first.
    const soloSurvivorMonths = 12 - ownMonths;
    const retirement = annualize(own, ownMonths);
    const survivorTopUp = annualize(Math.max(0, survivor - own), ownMonths);
    const survivorAlone = annualize(survivor, soloSurvivorMonths);
    return {
      retirement,
      spousal: 0,
      survivor: survivorTopUp + survivorAlone,
      total: retirement + survivorTopUp + survivorAlone,
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
    // Deeming needs BOTH spouses on the rolls, so the top-up starts at the
    // later of the two entitlement months — never before this worker's own
    // benefit, which is why spousalMonths <= ownMonths.
    const spousalMonths = monthsPaidInYear(laterOf(thisEntitlement, otherEntitlement), input.year);
    const t = topUp(own, spousal);
    const retirement = annualize(t.retirement, ownMonths);
    const spousalPortion = annualize(t.spousalPortion, spousalMonths);
    return {
      retirement,
      spousal: spousalPortion,
      survivor: 0,
      total: retirement + spousalPortion,
    };
  }

  // ── Case 3: other spouse not claimed / no spouse → own only ──────
  return {
    retirement: annualize(own, ownMonths),
    spousal: 0,
    survivor: 0,
    total: annualize(own, ownMonths),
  };
}
