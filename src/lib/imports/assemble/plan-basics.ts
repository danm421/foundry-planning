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
 * Deliberately NOT named `extractedPia`: the value round-trips to
 * `incomes.annualAmount`, which the engine reads as a literal annual benefit
 * (the seeded rows carry `ssBenefitMode = null`, i.e. "manual_amount"), so it
 * is not a PIA and no claiming-age actuarial adjustment is applied to it. The
 * wizard labels the field "Annual Social Security benefit" to match.
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
        pia: annual != null ? { value: annual, provenance: "document" } : blank<number>(),
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
