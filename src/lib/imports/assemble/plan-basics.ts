import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { numericAmount, sumExtractedLiving } from "../living-rows";
import type { ImportPayload } from "../types";
import type { AssemblePlanBasics, PlanBasicsField } from "./types";
import { blank } from "./field";

/**
 * Convention, not a finding: retirement spending defaults to 80% of current
 * spending. Single call site, and the chip says so plainly.
 */
export const RETIREMENT_SPENDING_REPLACEMENT_RATIO = 0.8;

/** Last-resort claiming age when we know nothing about the birth date. */
const FALLBACK_CLAIMING_AGE = 67;

export interface DerivePlanBasicsInput {
  payload: ImportPayload;
  known: {
    retirementAge: number;
    lifeExpectancy: number;
    spouseRetirementAge?: number | null;
    spouseLifeExpectancy?: number | null;
    primaryDob?: string;
    spouseDob?: string;
    hasSpouse: boolean;
  };
  mode: "new" | "refresh";
  /** Latest stored return, read by the caller. Null when none exists. */
  taxReturn?: { taxYear: number; agi: number | null; totalTax: number | null } | null;
}

/**
 * Find the extracted ANNUAL Social Security amount for one owner.
 *
 * Still named for the ANNUAL figure it reads: `incomes.annualAmount` is what
 * extraction fills in. The caller divides by 12 before it lands in
 * `planBasics.socialSecurity[].pia`, which is a MONTHLY PIA — see
 * `monthlyPiaFromAnnual` below.
 */
function extractedAnnualSocialSecurity(
  payload: ImportPayload,
  owner: "client" | "spouse",
): number | null {
  for (const row of payload.incomes) {
    if (row.type !== "social_security" || row.owner !== owner) continue;
    const amount = numericAmount(row.annualAmount);
    if (amount != null) return amount;
  }
  return null;
}

/**
 * Convert an extracted ANNUAL Social Security benefit into the MONTHLY PIA the
 * `pia` field carries.
 *
 * This field has two producers — this one and the planner's
 * `apply-decisions.ts`, whose `piaMonthly` is already monthly — so the units
 * are normalized HERE rather than at the commit write site. Leaving the annual
 * figure in a field that commits to the `pia_monthly` column would overstate
 * Social Security 12x on the document path.
 *
 * NOT a double adjustment — but the strength of that claim depends on the birth
 * year, so read the two cases separately.
 *
 * EXACT for FRA 67y0m, i.e. birth years from 1960 on. `claimingAgeField` below
 * defaults the claim age to FRA, and in `pia_at_fra` mode AT FRA the engine
 * applies neither an early reduction nor a delayed credit, so annual/12
 * reproduces exactly the yearly benefit the old literal-annual path produced.
 *
 * SLIGHTLY CONSERVATIVE for 1955-1959 birth years, whose FRA carries months
 * (66y2m-66y10m). `claimingAgeField` stores `fra.years` and DROPS `fra.months`,
 * so a 1957 birth year (FRA 66y6m) commits a claim age of 66y0m — six months
 * early. The engine then applies a real early reduction the old literal path
 * never applied, at 5/9% per month for the first 36 months
 * (engine/socialSecurity/ownRetirement.ts:45), so the understatement runs up to
 * 10 months x 5/9% = 5.56% at the 1955 end of the range. Deferred as future
 * work: carrying the months needs either a widened `PlanBasicsField<number>` or
 * `claimingAgeMode: "fra"`, and both ripple into the wizard.
 *
 * Rounded to 2 decimals because `incomes.pia_monthly` is `decimal(15,2)`;
 * rounding here keeps what the advisor reviews identical to what is stored.
 */
function monthlyPiaFromAnnual(annual: number): number {
  return Math.round((annual / 12) * 100) / 100;
}

function claimingAgeField(dob: string | undefined): PlanBasicsField<number> {
  if (!dob) {
    return {
      value: FALLBACK_CLAIMING_AGE,
      provenance: "derived",
      reason: `Defaulted to full retirement age (${FALLBACK_CLAIMING_AGE}); no date of birth on file.`,
    };
  }
  const fra = fraForBirthDate(dob);
  const birthYear = new Date(dob).getUTCFullYear();
  return {
    value: fra.years,
    provenance: "derived",
    reason: `Defaulted to full retirement age (${fra.years}) for a ${birthYear} birth year.`,
  };
}

/**
 * Derive the plan-level values from evidence. Pure and deterministic — no
 * Date.now, no Math.random, no IO. The tax-return read happens in the caller
 * and arrives as an argument, mirroring how fillAssumptions takes `known`.
 *
 * The governing rule: derive from evidence, or go blank and flag it. Never a
 * bare constant presented as a finding.
 */
export function derivePlanBasics(input: DerivePlanBasicsInput): AssemblePlanBasics {
  const { payload, known, mode, taxReturn } = input;
  const ageProvenance = mode === "new" ? "build_request" : "client_record";

  // ── Current living spending: extracted (summed) → AGI − totalTax → blank ──
  let currentLivingSpending: PlanBasicsField<number>;
  const stated = sumExtractedLiving(payload);
  if (stated != null) {
    currentLivingSpending =
      stated.count > 1
        ? {
            value: stated.total,
            provenance: "document",
            reason: `Summed from ${stated.count} extracted living-expense rows.`,
          }
        : { value: stated.total, provenance: "document" };
  } else if (taxReturn && taxReturn.agi != null && taxReturn.totalTax != null) {
    currentLivingSpending = {
      value: taxReturn.agi - taxReturn.totalTax,
      provenance: "derived",
      reason:
        `Estimated from the ${taxReturn.taxYear} return: AGI minus total tax. ` +
        `Does not account for saving into taxable accounts.`,
    };
  } else {
    currentLivingSpending = blank<number>();
  }

  // ── Retirement spending cascades off whatever current resolved to. ──
  const retirementLivingSpending: PlanBasicsField<number> =
    currentLivingSpending.value == null
      ? blank<number>()
      : {
          value: Math.round(currentLivingSpending.value * RETIREMENT_SPENDING_REPLACEMENT_RATIO),
          provenance: "derived",
          reason: "Estimated at 80% of current living expenses.",
        };

  const owners: Array<{ owner: "client" | "spouse"; dob?: string }> = [
    { owner: "client", dob: known.primaryDob },
  ];
  if (known.hasSpouse) owners.push({ owner: "spouse", dob: known.spouseDob });

  const basics: AssemblePlanBasics = {
    retirementAge: { value: known.retirementAge, provenance: ageProvenance },
    lifeExpectancy: { value: known.lifeExpectancy, provenance: ageProvenance },
    currentLivingSpending,
    retirementLivingSpending,
    socialSecurity: owners.map(({ owner, dob }) => {
      const annual = extractedAnnualSocialSecurity(payload, owner);
      return {
        owner,
        // `provenance: "document"` survives the unit conversion — it is the
        // same document fact in different units, not an assumption.
        pia:
          annual != null
            ? { value: monthlyPiaFromAnnual(annual), provenance: "document" }
            : blank<number>(),
        claimingAge: claimingAgeField(dob),
      };
    }),
  };

  if (known.hasSpouse) {
    // A missing spouse age is absent evidence, not a confident read off the
    // client record / build request — it must go blank and flagged like
    // every other unset field, not silently carry ageProvenance on a null.
    basics.spouseRetirementAge =
      known.spouseRetirementAge != null
        ? { value: known.spouseRetirementAge, provenance: ageProvenance }
        : blank<number>();
    basics.spouseLifeExpectancy =
      known.spouseLifeExpectancy != null
        ? { value: known.spouseLifeExpectancy, provenance: ageProvenance }
        : blank<number>();
  }

  return basics;
}

/**
 * All-blank plan basics for an import assembled before this feature
 * existed, or one where `derivePlanBasics` had too little evidence to run
 * at all (see `runAssemble` — it requires both `retirementAge` and
 * `lifeExpectancy` to be known). Every field is blank and unflagged — no
 * `reason`, so no chip — so the wizard's Plan basics step renders empty
 * inputs instead of crashing on a missing `planBasics` block.
 */
export function emptyPlanBasics(): AssemblePlanBasics {
  return {
    retirementAge: blank<number>(),
    lifeExpectancy: blank<number>(),
    currentLivingSpending: blank<number>(),
    retirementLivingSpending: blank<number>(),
    socialSecurity: [],
  };
}
