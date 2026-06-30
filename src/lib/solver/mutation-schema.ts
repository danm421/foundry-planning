// src/lib/solver/mutation-schema.ts
//
// Zod schema for the SolverMutation union, shared by the live-recompute
// (`/api/clients/[id]/solver/project`) and the persistence
// (`/api/clients/[id]/solver/save-scenario`) routes. Keep this in sync
// with the SolverMutation union in `./types.ts` — every new mutation kind
// must be added here too or the route silently rejects edits with 400 and
// the bar chart stops updating.

import { z } from "zod";

const PERSON = z.enum(["client", "spouse"]);

const SS_BENEFIT_MODE = z.enum(["pia_at_fra", "manual_amount", "no_benefit"]);
const SS_CLAIM_AGE_MODE = z.enum(["fra", "at_retirement", "years"]);
const GROWTH_SOURCE = z.enum(["custom", "inflation"]);
const INCOME_TAX_TYPE = z.enum([
  "earned_income",
  "ordinary_income",
  "dividends",
  "capital_gains",
  "qbi",
  "tax_exempt",
  "stcg",
]);

const YEAR = z.number().int().min(1950).max(2150);
const MONEY = z.number().min(0).max(100_000_000);
const RATE = z.number().min(-1).max(2); // decimal (-100% to 200%) — leave slack for what-ifs

const ROTH_CONVERSION_VALUE = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    destinationAccountId: z.string().min(1),
    sourceAccountIds: z.array(z.string().min(1)),
    conversionType: z.enum([
      "fixed_amount",
      "full_account",
      "deplete_over_period",
      "fill_up_bracket",
    ]),
    fixedAmount: MONEY,
    fillUpBracket: z.number().min(0).max(1).optional(),
    startYear: YEAR,
    endYear: YEAR.optional(),
    indexingRate: RATE,
    inflationStartYear: YEAR.optional(),
  })
  .passthrough();

const ASSET_TRANSACTION_VALUE = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    type: z.enum(["buy", "sell"]),
    year: YEAR,
    accountId: z.string().min(1).optional(),
    purchaseTransactionId: z.string().min(1).nullable().optional(),
    businessAccountId: z.string().min(1).optional(),
  })
  .passthrough()
  .refine(
    (t) => {
      if (t.type !== "sell") return true;
      const sources = [t.accountId, t.purchaseTransactionId, t.businessAccountId].filter(
        (v) => v != null && v !== "",
      );
      return sources.length <= 1;
    },
    {
      message:
        "Sell transactions may set at most one of accountId / purchaseTransactionId / businessAccountId",
    },
  );

const REINVESTMENT_VALUE = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    accountIds: z.array(z.string().min(1)),
    year: YEAR,
    realizeTaxesOnSwitch: z.boolean(),
  })
  .passthrough();

const ACCOUNT_VALUE = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    // Must match Account["category"] in src/engine/types.ts exactly — the
    // revocable-trust lever upserts every probate-eligible account (incl.
    // stock_options), so any missing member 400s the recompute.
    category: z.enum([
      "taxable", "cash", "retirement", "annuity", "real_estate",
      "business", "life_insurance", "notes_receivable", "stock_options",
    ]),
    subType: z.string().min(1),
    value: MONEY,
    basis: MONEY,
    growthRate: RATE,
    rmdEnabled: z.boolean(),
    titlingType: z.enum(["jtwros", "community_property"]),
    // No `.min(1)` — ownerless accounts are a real state (e.g. "Household Cash",
    // unowned Plaid accounts). resolve-entity loads them with `owners: []`, so an
    // account-upsert that spreads such an account must validate, or the
    // revocable-trust lever 400s the recompute.
    owners: z.array(z.object({ kind: z.string(), percent: z.number() }).passthrough()),
  })
  .passthrough();

const SAVINGS_RULE_VALUE = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    annualAmount: MONEY,
    isDeductible: z.boolean(),
    startYear: YEAR,
    endYear: YEAR,
    fundFromExpenseReduction: z.boolean().optional(),
    rothPercent: z.number().min(0).max(1).nullable().optional(),
    growthRate: RATE.optional(),
  })
  .passthrough();

const GRANTOR = z.enum(["client", "spouse", "joint"]);
const GIFT_EVENT_KIND = z.enum(["outright", "clt_remainder_interest"]);
const GIFT_RECIPIENT = z.object({
  kind: z.enum(["entity", "family_member", "external_beneficiary"]),
  id: z.string().min(1),
});

const GIFT_VALUE = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cash-once"),
    id: z.string().min(1),
    year: YEAR,
    amount: MONEY,
    grantor: GRANTOR,
    recipient: GIFT_RECIPIENT,
    crummey: z.boolean(),
    eventKind: GIFT_EVENT_KIND.optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("asset-once"),
    id: z.string().min(1),
    year: YEAR,
    accountId: z.string().min(1),
    percent: z.number().min(0).max(1),
    grantor: GRANTOR,
    recipient: GIFT_RECIPIENT,
    amountOverride: MONEY.optional(),
    eventKind: GIFT_EVENT_KIND.optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("series"),
    id: z.string().min(1),
    startYear: YEAR,
    endYear: YEAR,
    annualAmount: MONEY,
    amountMode: z.enum(["fixed", "annual_exclusion"]),
    inflationAdjust: z.boolean(),
    grantor: GRANTOR,
    recipient: GIFT_RECIPIENT,
    crummey: z.boolean(),
    enabled: z.boolean().optional(),
  }),
]);

const EXTERNAL_BENEFICIARY_VALUE = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["charity", "individual"]),
  charityType: z.enum(["public", "private"]),
});

const TRUST_SUB_TYPE = z.enum(["irrevocable", "ilit", "clt", "idgt", "crt"]);
const ENTITY_TYPE = z.enum(["trust", "llc", "s_corp", "c_corp", "partnership", "other", "foundation"]);

const SPLIT_INTEREST_SNAPSHOT = z.object({
  inceptionYear: z.number().int(),
  inceptionValue: z.number().nonnegative(),
  payoutType: z.enum(["unitrust", "annuity"]),
  payoutPercent: z.number().nullable(),
  payoutAmount: z.number().nullable(),
  irc7520Rate: z.number().nonnegative(),
  termType: z.enum(["years", "single_life", "joint_life", "shorter_of_years_or_life"]),
  termYears: z.number().nullable(),
  measuringLife1Id: z.string().nullable(),
  measuringLife2Id: z.string().nullable(),
  charityId: z.string().min(1),
  originalIncomeInterest: z.number().nonnegative(),
  originalRemainderInterest: z.number().nonnegative(),
});

const ENTITY_VALUE = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    entityType: ENTITY_TYPE,
    isIrrevocable: z.boolean(),
    isGrantor: z.boolean(),
    includeInPortfolio: z.boolean(),
    grantor: PERSON.optional(),
    trustSubType: TRUST_SUB_TYPE.optional(),
    crummeyPowers: z.boolean().optional(),
    accessibleToClient: z.boolean().optional(),
    trustEnds: z.enum(["client_death", "spouse_death", "survivorship"]).nullable().optional(),
    grantorStatusEndYear: z.number().int().optional(),
    splitInterest: SPLIT_INTEREST_SNAPSHOT.optional(),
  })
  .passthrough();

export const SOLVER_MUTATION_SCHEMA = z.discriminatedUnion("kind", [
  // Goals
  z.object({
    kind: z.literal("retirement-age"),
    person: PERSON,
    age: z.number().int().min(40).max(85),
    month: z.number().int().min(1).max(12).optional(),
  }),
  z.object({
    kind: z.literal("life-expectancy"),
    person: PERSON,
    age: z.number().int().min(1).max(120),
  }),

  // Social Security
  z.object({
    kind: z.literal("ss-claim-age"),
    person: PERSON,
    age: z.number().int().min(62).max(70),
    months: z.number().int().min(0).max(11).optional(),
  }),
  z.object({
    kind: z.literal("ss-claim-age-mode"),
    person: PERSON,
    mode: SS_CLAIM_AGE_MODE,
  }),
  z.object({
    kind: z.literal("ss-benefit-mode"),
    person: PERSON,
    mode: SS_BENEFIT_MODE,
  }),
  z.object({
    kind: z.literal("ss-pia-monthly"),
    person: PERSON,
    amount: z.number().min(0).max(100_000),
  }),
  z.object({
    kind: z.literal("ss-annual-amount"),
    person: PERSON,
    amount: MONEY,
  }),
  z.object({
    kind: z.literal("ss-cola"),
    person: PERSON,
    rate: RATE,
  }),

  // Expenses
  z.object({
    kind: z.literal("living-expense-scale"),
    multiplier: z.number().min(0.1).max(3),
  }),
  z.object({
    kind: z.literal("living-expense-amount"),
    amount: MONEY,
  }),
  z.object({
    kind: z.literal("expense-annual-amount"),
    expenseId: z.string().uuid(),
    annualAmount: MONEY,
  }),

  // Incomes (non-SS)
  z.object({
    kind: z.literal("income-annual-amount"),
    incomeId: z.string().uuid(),
    annualAmount: MONEY,
  }),
  z.object({
    kind: z.literal("income-growth-rate"),
    incomeId: z.string().uuid(),
    rate: RATE,
  }),
  z.object({
    kind: z.literal("income-growth-source"),
    incomeId: z.string().uuid(),
    source: GROWTH_SOURCE,
  }),
  z.object({
    kind: z.literal("income-tax-type"),
    incomeId: z.string().uuid(),
    taxType: INCOME_TAX_TYPE,
  }),
  z.object({
    kind: z.literal("income-self-employment"),
    incomeId: z.string().uuid(),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal("income-start-year"),
    incomeId: z.string().uuid(),
    year: YEAR,
  }),
  z.object({
    kind: z.literal("income-end-year"),
    incomeId: z.string().uuid(),
    year: YEAR,
  }),

  // Savings
  z.object({
    kind: z.literal("savings-contribution"),
    accountId: z.string().uuid(),
    annualAmount: MONEY,
  }),
  z.object({
    kind: z.literal("savings-annual-percent"),
    accountId: z.string().uuid(),
    percent: z.number().min(0).max(1).nullable(),
  }),
  z.object({
    kind: z.literal("savings-roth-percent"),
    accountId: z.string().uuid(),
    rothPercent: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("savings-contribute-max"),
    accountId: z.string().uuid(),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal("savings-growth-rate"),
    accountId: z.string().uuid(),
    rate: RATE,
  }),
  z.object({
    kind: z.literal("savings-growth-source"),
    accountId: z.string().uuid(),
    source: GROWTH_SOURCE,
  }),
  z.object({
    kind: z.literal("savings-deductible"),
    accountId: z.string().uuid(),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal("savings-apply-cap"),
    accountId: z.string().uuid(),
    value: z.boolean(),
  }),
  z.object({
    kind: z.literal("savings-employer-match-pct"),
    accountId: z.string().uuid(),
    pct: z.number().min(0).max(2),
    cap: z.number().min(0).max(1).nullable(),
  }),
  z.object({
    kind: z.literal("savings-employer-match-amount"),
    accountId: z.string().uuid(),
    amount: MONEY,
  }),
  z.object({
    kind: z.literal("savings-start-year"),
    accountId: z.string().uuid(),
    year: YEAR,
  }),
  z.object({
    kind: z.literal("savings-end-year"),
    accountId: z.string().uuid(),
    year: YEAR,
  }),

  // Technique upserts
  z.object({
    kind: z.literal("roth-conversion-upsert"),
    id: z.string().min(1),
    value: ROTH_CONVERSION_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("asset-transaction-upsert"),
    id: z.string().min(1),
    value: ASSET_TRANSACTION_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("reinvestment-upsert"),
    id: z.string().min(1),
    value: REINVESTMENT_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("account-upsert"),
    id: z.string().min(1),
    value: ACCOUNT_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("savings-rule-upsert"),
    id: z.string().min(1),
    value: SAVINGS_RULE_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("gift-upsert"),
    id: z.string().min(1),
    value: GIFT_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("external-beneficiary-upsert"),
    id: z.string().min(1),
    value: EXTERNAL_BENEFICIARY_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("entity-upsert"),
    id: z.string().min(1),
    value: ENTITY_VALUE.nullable(),
  }),
  z.object({
    kind: z.literal("stress-inflation"),
    rate: RATE,
  }),
  z.object({
    kind: z.literal("stress-ss-haircut"),
    pct: z.number().min(0).max(1),
    startYear: YEAR,
  }),
  z.object({
    kind: z.literal("stress-disability"),
    person: PERSON,
    startYear: YEAR,
  }),
  z.object({
    kind: z.literal("stress-market-crash"),
    year: YEAR,
    drawdownPct: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("stress-exemption-cap"),
    cap: MONEY,
  }),
]);

export type SolverMutationFromSchema = z.infer<typeof SOLVER_MUTATION_SCHEMA>;
