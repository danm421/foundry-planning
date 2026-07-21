import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import type { ImportPayload } from "../types";
import type { AssemblePlanBasics, PlanBasicsField } from "./types";

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

function blank<T>(): PlanBasicsField<T> {
  return { value: null, provenance: "derived" };
}

/**
 * Normalize an extracted amount that is typed `number` but is not
 * runtime-guaranteed to be one — the extraction schema (`extraction-schema.ts`)
 * is a loose Zod object that lets raw LLM output (occasionally a numeric
 * string) flow through unchanged. `commit/incomes.ts` defends against the
 * same thing with `Number(row.annualAmount)`.
 */
function numericAmount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Sum every extracted living-expense row. The extraction prompt tags
 * housing, groceries, utilities, transportation, dining, etc. as separate
 * `"living"`-typed rows (see `expense-worksheet.ts`) — taking only the first
 * one silently discards the rest. `count` lets the caller disclose when more
 * than one row was combined.
 */
function extractedLiving(payload: ImportPayload): { total: number; count: number } | null {
  let total = 0;
  let count = 0;
  for (const row of payload.expenses) {
    if (row.type !== "living") continue;
    const amount = numericAmount(row.annualAmount);
    if (amount == null) continue;
    total += amount;
    count += 1;
  }
  return count > 0 ? { total, count } : null;
}

/** Find an extracted Social Security income row for one owner. */
function extractedPia(payload: ImportPayload, owner: "client" | "spouse"): number | null {
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
  const stated = extractedLiving(payload);
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
      const pia = extractedPia(payload, owner);
      return {
        owner,
        pia: pia != null ? { value: pia, provenance: "document" } : blank<number>(),
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
