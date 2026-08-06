import { z } from "zod";

/** Facts are a point-in-time snapshot of a FILED return — never recomputed
 *  from plan data. All money fields nullable: extraction fills what it finds,
 *  observations degrade per-field. */

export const TAX_RETURN_MIN_YEAR = 2022; // earliest seeded tax_year_parameters row
export const TAX_RETURN_MAX_YEAR = 2100; // matches the tax_year_parameters upper bound / plausibility ceiling

const money = z.number().finite().nullable();
const count = z.number().int().min(0).nullable();

const filingStatusValues = [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
] as const;

const scheduleASchema = z
  .object({
    saltPaid: money,        // Sched A line 5d (pre-cap)
    saltDeducted: money,    // Sched A line 7 (post-§164 cap)
    mortgageInterest: money,
    charitableCash: money,
    charitableNonCash: money,
    medical: money,         // deducted portion (post-7.5%-AGI floor)
  })
  .strict();

/**
 * Schedule E Part I detail, TOTALLED across every rental property on the
 * return. `income.scheduleENet` already carries the bottom line (Sched 1
 * line 5), so the net is deliberately NOT restated here — this block exists to
 * answer the questions the net alone cannot:
 *
 *  - `grossRents` is the actual money the properties collected. A rental that
 *    nets to a LOSS after depreciation still produced real rent, and before
 *    this block existed that figure had nowhere to live: a $19,600 rental
 *    showing a $6,141 loss looked identical to no rental at all.
 *  - `depreciation` is a NON-CASH deduction, so cash flow is roughly
 *    `scheduleENet + depreciation` — the loss-on-paper / positive-in-cash case
 *    this app exists to model.
 *  - `suspendedPassiveLoss` is the §469 loss the return could NOT use this
 *    year (Form 8582). It carries forward, so it is a future-year tax asset.
 *
 * Per-PROPERTY breakdown is deliberately out of scope here: these facts are a
 * single-year 1040 snapshot for tax analysis, and the import wizard already
 * emits one income row per property for plan building.
 */
const scheduleESchema = z
  .object({
    grossRents: money,           // Sched E line 3, all properties
    totalExpenses: money,        // line 20
    depreciation: money,         // line 18 (non-cash)
    mortgageInterest: money,     // line 12
    propertyTaxes: money,        // line 16
    suspendedPassiveLoss: money, // Form 8582 unallowed loss; positive number
  })
  .strict();

export type ScheduleAFacts = z.infer<typeof scheduleASchema>;
export type ScheduleEFacts = z.infer<typeof scheduleESchema>;

/**
 * Canonical all-null blocks. Both the extraction conformer (which needs the
 * shape as a template) and the review form (which needs it as initial state)
 * read these, so adding a field to a block above can no longer leave either
 * site silently behind. Functions, not shared constants — callers treat the
 * result as their own mutable state.
 */
export const emptyScheduleA = (): ScheduleAFacts => ({
  saltPaid: null, saltDeducted: null, mortgageInterest: null,
  charitableCash: null, charitableNonCash: null, medical: null,
});

export const emptyScheduleE = (): ScheduleEFacts => ({
  grossRents: null, totalExpenses: null, depreciation: null,
  mortgageInterest: null, propertyTaxes: null, suspendedPassiveLoss: null,
});

export const taxReturnFactsSchema = z
  .object({
    taxYear: z.number().int().min(TAX_RETURN_MIN_YEAR).max(TAX_RETURN_MAX_YEAR),
    filingStatus: z.enum(filingStatusValues).nullable(),
    residenceState: z.string().length(2).nullable(),
    dependentsUnder17: count,
    dependents17to23: count,
    income: z
      .object({
        wages: money,                 // 1040 line 1a
        taxableInterest: money,       // 2b
        taxExemptInterest: money,     // 2a
        ordinaryDividends: money,     // 3b
        qualifiedDividends: money,    // 3a
        iraDistributionsGross: money, // 4a
        iraDistributionsTaxable: money, // 4b
        pensionsGross: money,         // 5a
        pensionsTaxable: money,       // 5b
        ssBenefitsGross: money,       // 6a
        ssBenefitsTaxable: money,     // 6b
        capitalGainOrLoss: money,     // 7 (net; negative = loss)
        netLongTermGain: money,       // Sched D line 15 (null if no Sched D)
        netShortTermGain: money,      // Sched D line 7
        scheduleCNet: money,          // Sched 1 line 3
        scheduleENet: money,          // Sched 1 line 5
        /**
         * `.default(null)` is LOAD-BEARING, not decoration. `parseRowFacts`
         * re-validates ALREADY-PERSISTED jsonb through this schema on every
         * read, and every row written before this field existed has no
         * `scheduleE` key. A plain `.nullable()` still requires the key, so it
         * would fail those rows and blank the Tax Analysis tab for every
         * existing client. The default makes the key optional on INPUT while
         * keeping the output type non-optional. Do not "tidy" it away.
         */
        scheduleE: scheduleESchema.nullable().default(null),
        unemployment: money,          // Sched 1 line 7
        otherIncome: money,           // Sched 1 line 9 remainder
        totalIncome: money,           // 1040 line 9
        adjustmentsToIncome: money,   // 1040 line 10 (Sched 1 part II)
        agi: money,                   // 1040 line 11
      })
      .strict(),
    deductions: z
      .object({
        deductionTaken: z.enum(["standard", "itemized"]).nullable(),
        deductionAmount: money,       // 1040 line 12
        qbiDeduction: money,          // 1040 line 13
        taxableIncome: money,         // 1040 line 15
        scheduleA: scheduleASchema.nullable(),
      })
      .strict(),
    tax: z
      .object({
        taxBeforeCredits: money,      // 1040 line 16
        amt: money,                   // Sched 2 line 1
        excessAptcRepayment: money,   // Sched 2 line 2
        childTaxCredit: money,        // 1040 line 19
        educationCredits: money,      // Sched 3 line 3
        foreignTaxCredit: money,      // Sched 3 line 1
        energyCredits: money,         // Sched 3 line 5a/5b
        otherCredits: money,
        seTax: money,                 // Sched 2 line 4
        niit: money,                  // Sched 2 line 12 (Form 8960)
        additionalMedicareTax: money, // Sched 2 line 11 (Form 8959)
        otherTaxes: money,
        totalTax: money,              // 1040 line 24
      })
      .strict(),
    payments: z
      .object({
        withholding: money,           // 1040 line 25d
        estimatedPayments: money,     // 1040 line 26
        otherPayments: money,
        refund: money,                // 1040 line 34
        amountOwed: money,            // 1040 line 37
      })
      .strict(),
    carryovers: z
      .object({
        capitalLossCarryover: money,  // Sched D worksheet; positive number
      })
      .strict(),
  })
  .strict();

export type TaxReturnFacts = z.infer<typeof taxReturnFactsSchema>;
export type TaxReturnFilingStatus = NonNullable<TaxReturnFacts["filingStatus"]>;

export function emptyTaxReturnFacts(taxYear: number): TaxReturnFacts {
  return {
    taxYear,
    filingStatus: null,
    residenceState: null,
    dependentsUnder17: null,
    dependents17to23: null,
    income: {
      wages: null, taxableInterest: null, taxExemptInterest: null,
      ordinaryDividends: null, qualifiedDividends: null,
      iraDistributionsGross: null, iraDistributionsTaxable: null,
      pensionsGross: null, pensionsTaxable: null,
      ssBenefitsGross: null, ssBenefitsTaxable: null,
      capitalGainOrLoss: null, netLongTermGain: null, netShortTermGain: null,
      scheduleCNet: null, scheduleENet: null, scheduleE: null, unemployment: null,
      otherIncome: null, totalIncome: null, adjustmentsToIncome: null,
      agi: null,
    },
    deductions: {
      deductionTaken: null, deductionAmount: null, qbiDeduction: null,
      taxableIncome: null, scheduleA: null,
    },
    tax: {
      taxBeforeCredits: null, amt: null, excessAptcRepayment: null,
      childTaxCredit: null, educationCredits: null, foreignTaxCredit: null,
      energyCredits: null, otherCredits: null, seTax: null, niit: null,
      additionalMedicareTax: null, otherTaxes: null, totalTax: null,
    },
    payments: {
      withholding: null, estimatedPayments: null, otherPayments: null,
      refund: null, amountOwed: null,
    },
    carryovers: { capitalLossCarryover: null },
  };
}
