// src/lib/whatif/changes.ts
//
// The plain-language what-if vocabulary the Claude connector accepts. Each
// member is a shape a model can fill from one sentence; translate.ts turns it
// into the Solver's own mutations (src/lib/solver/types.ts). Pure: no Next,
// no database.
//
// One lever per member, no optional-field combinations that need a refine:
// a plain z.object keeps the discriminated union valid and the MCP JSON
// schema readable.
import { z } from "zod";
import { isUSPSStateCode } from "@/lib/usps-states";
import { MAX_RATE_STRESS_POINTS } from "@/lib/tax/rate-stress";

const PERSON = z.enum(["client", "spouse"]).describe("'client' or 'spouse'.");
const YEAR = z.number().int().min(1950).max(2150);
const MONEY = z.number().min(0).max(100_000_000);
const RATE = z.number().min(-1).max(2).describe("A decimal fraction: 0.03 means 3%.");
const ID = z.string().min(1);

/** Federal ordinary-income bracket rates a bracket-fill conversion may fill up to. */
export const FILLABLE_BRACKETS = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35] as const;

export const WHAT_IF_CHANGE_SCHEMA = z.discriminatedUnion("type", [
  // ── Simple levers (map 1:1 onto Solver mutations) ─────────────────────────
  z
    .object({
      type: z.literal("retirement_age"),
      person: PERSON,
      age: z.number().int().min(40).max(85),
      month: z.number().int().min(1).max(12).optional(),
    })
    .describe("Retire at a different age."),
  z
    .object({ type: z.literal("spending_scale"), multiplier: z.number().min(0.1).max(3) })
    .describe("Scale retirement living expenses, e.g. 0.9 spends 10% less."),
  z
    .object({ type: z.literal("spending_amount"), annualAmount: MONEY })
    .describe("Set retirement living expenses to an annual amount in today's dollars."),
  z
    .object({ type: z.literal("expense_amount"), expenseId: ID, annualAmount: MONEY })
    .describe("Change one expense's annual amount. Ids from list_plan_details kind 'expense'."),
  z
    .object({ type: z.literal("income_amount"), incomeId: ID, annualAmount: MONEY })
    .describe("Change one non-Social-Security income's annual amount. Ids from list_plan_details kind 'income'."),
  z
    .object({
      type: z.literal("income_years"),
      incomeId: ID,
      startYear: YEAR.optional(),
      endYear: YEAR.optional(),
    })
    .describe("Move when an income starts or stops."),
  z
    .object({ type: z.literal("income_growth"), incomeId: ID, growthRate: RATE })
    .describe("Change an income's annual growth rate."),
  z
    .object({
      type: z.literal("ss_claim_age"),
      person: PERSON,
      age: z.number().int().min(62).max(70),
      months: z.number().int().min(0).max(11).optional(),
    })
    .describe("Claim Social Security at a given age."),
  z
    .object({ type: z.literal("ss_pia"), person: PERSON, piaMonthly: z.number().min(0).max(100_000) })
    .describe("Set the monthly Social Security benefit at full retirement age (the PIA)."),
  z
    .object({ type: z.literal("ss_annual_benefit"), person: PERSON, annualAmount: MONEY })
    .describe("Set a flat annual Social Security benefit."),
  z
    .object({ type: z.literal("ss_no_benefit"), person: PERSON })
    .describe("Model no Social Security benefit for this person."),
  z
    .object({ type: z.literal("ss_cola"), person: PERSON, rate: RATE })
    .describe("Change the Social Security cost-of-living adjustment."),
  z
    .object({ type: z.literal("savings_amount"), accountId: ID, annualAmount: MONEY })
    .describe("Set annual contributions to an account that already has a savings rule."),
  z
    .object({ type: z.literal("savings_percent"), accountId: ID, percentOfSalary: z.number().min(0).max(1) })
    .describe("Contribute a share of salary instead, e.g. 0.1 is 10%."),
  z
    .object({ type: z.literal("savings_roth_percent"), accountId: ID, rothPercent: z.number().min(0).max(1) })
    .describe("Share of an account's contributions that go to the Roth side."),
  z
    .object({ type: z.literal("savings_max"), accountId: ID, contributeMax: z.boolean() })
    .describe("Contribute the IRS maximum each year."),
  z
    .object({
      type: z.literal("savings_years"),
      accountId: ID,
      startYear: YEAR.optional(),
      endYear: YEAR.optional(),
    })
    .describe("Move when contributions start or stop."),
  z
    .object({ type: z.literal("life_expectancy"), person: PERSON, age: z.number().int().min(60).max(120) })
    .describe("Change a life expectancy. The plan runs to the later death."),
  z
    .object({ type: z.literal("stress_inflation"), rate: RATE })
    .describe("Stress test: a different inflation rate."),
  z
    .object({ type: z.literal("stress_ss_haircut"), pct: z.number().min(0).max(1), startYear: YEAR })
    .describe("Stress test: cut Social Security by a share, from a year on."),
  z
    .object({ type: z.literal("stress_market_crash"), year: YEAR, drawdownPct: z.number().min(0).max(1) })
    .describe("Stress test: a market drop in one year, e.g. drawdownPct 0.3."),
  z
    .object({
      type: z.literal("stress_tax_rates"),
      points: z.number().min(0).max(MAX_RATE_STRESS_POINTS),
      startYear: YEAR,
    })
    .describe("Stress test: raise income tax rates by percentage points, e.g. 0.05."),
  z
    .object({ type: z.literal("stress_exemption_cap"), cap: MONEY })
    .describe("Stress test: a lower estate tax exemption per person."),
  z
    .object({
      type: z.literal("stress_disability"),
      person: PERSON,
      startYear: YEAR,
      endYear: YEAR.optional(),
    })
    .describe("Stress test: a disability that stops earned income."),

  // ── Techniques (plain shape → a full record built server-side) ───────────
  z
    .object({
      type: z.literal("roth_conversion"),
      fromAccountIds: z
        .array(ID)
        .min(1)
        .max(5)
        .describe("Pre-tax retirement accounts to convert from (traditional IRA, 401k, 403b, SEP, SIMPLE)."),
      toAccountId: ID.describe("The Roth IRA to convert into."),
      mode: z.enum(["fixed_amount", "fill_bracket", "deplete_over_period", "full_account"]),
      amount: MONEY.optional().describe("fixed_amount only, and required for it: gross dollars converted each year."),
      indexingRate: RATE.optional().describe("fixed_amount only: grow the amount each year by this rate."),
      bracket: z
        .number()
        .optional()
        .describe(`fill_bracket only, and required for it: the federal bracket rate to fill up to, one of ${FILLABLE_BRACKETS.join(", ")}.`),
      irmaaCapTier: z
        .number()
        .int()
        .min(0)
        .max(4)
        .optional()
        .describe("Optional: the highest Medicare IRMAA tier the conversion may push income into (0 stays surcharge-free)."),
      startYear: YEAR,
      endYear: YEAR.optional().describe("Last conversion year. Required for deplete_over_period."),
      name: z.string().max(60).optional(),
    })
    .describe("Add a Roth conversion."),
  z
    .object({
      type: z.literal("asset_sale"),
      accountId: ID.describe("A taxable, real estate or business account."),
      year: YEAR,
      fraction: z.number().gt(0).max(1).optional().describe("Share sold, e.g. 0.5. Default: all of it."),
      proceedsAccountId: ID.optional().describe("Cash or taxable account that receives the proceeds. Default: the household's checking."),
      name: z.string().max(60).optional(),
    })
    .describe("Sell an asset in a given year."),
  z
    .object({
      type: z.literal("asset_purchase"),
      name: z.string().min(1).max(60),
      propertyType: z.enum(["primary_residence", "rental_property", "commercial_property"]),
      year: YEAR,
      purchasePrice: MONEY,
      fundingAccountId: ID.optional().describe("Account the cash portion comes from. Default: the household's checking."),
      mortgageAmount: MONEY.optional(),
      mortgageRate: RATE.optional().describe("Required with mortgageAmount."),
      mortgageTermMonths: z.number().int().min(12).max(480).optional().describe("Default 360."),
      annualPropertyTax: MONEY.optional(),
      growthRate: RATE.optional().describe("Default: the plan's real estate growth rate."),
    })
    .describe("Buy real estate in a given year."),
  z
    .object({
      type: z.literal("gift"),
      familyMemberId: ID.optional().describe("Recipient family member (list_plan_details kind 'family_member'). Give this or charityId."),
      charityId: ID.optional().describe("Recipient charity (list_plan_details kind 'external_beneficiary')."),
      grantor: z.enum(["client", "spouse", "joint"]),
      amount: MONEY,
      startYear: YEAR,
      endYear: YEAR.optional().describe("Repeat the gift every year through this year."),
      annualExclusion: z.boolean().optional().describe("Repeat at the annual exclusion amount instead of a fixed amount."),
    })
    .describe("Make a cash gift, once or every year."),
  z
    .object({
      type: z.literal("relocation"),
      year: YEAR,
      state: z.string().length(2).refine(isUSPSStateCode, "state must be a two-letter US state code"),
    })
    .describe("Move to another state."),
  z
    .object({
      type: z.literal("pay_off_debt"),
      liabilityId: ID,
      frequency: z.enum(["one_time", "monthly", "annual"]),
      amount: MONEY.describe(
        "Extra principal: the monthly extra for 'monthly', the yearly amount otherwise. A one-time amount above the balance pays the loan off.",
      ),
      startYear: YEAR,
      endYear: YEAR.optional().describe("Last year for 'monthly' or 'annual'. Default: startYear."),
    })
    .describe("Pay extra principal on a loan."),
  z
    .object({
      type: z.literal("add_income"),
      name: z.string().min(1).max(60),
      owner: z.enum(["client", "spouse", "joint"]),
      annualAmount: MONEY,
      startYear: YEAR,
      endYear: YEAR,
      growthRate: RATE.optional().describe("Default: grows with inflation."),
    })
    .describe("Add an income stream, taxed as ordinary income."),
  z
    .object({
      type: z.literal("add_expense"),
      name: z.string().min(1).max(60),
      annualAmount: MONEY,
      startYear: YEAR,
      endYear: YEAR,
      growthRate: RATE.optional().describe("Default: grows with inflation."),
    })
    .describe("Add an expense."),
  z
    .object({
      type: z.literal("add_account"),
      accountType: z.enum(["taxable", "ira", "roth_ira", "cash"]),
      owner: PERSON,
      balance: MONEY,
      annualSavings: MONEY.optional(),
      savingsStartYear: YEAR.optional().describe("Default: the first plan year."),
      savingsEndYear: YEAR.optional().describe("Default: the owner's retirement year."),
      growthRate: RATE.optional().describe("Default: the plan's growth rate for that kind of account."),
      name: z.string().max(60).optional(),
    })
    .describe("Add an account, optionally with yearly savings into it."),
  z
    .object({
      type: z.literal("remove"),
      kind: z.enum(["income", "expense", "account", "liability", "roth_conversion", "asset_transaction"]),
      id: ID,
    })
    .describe("Leave an existing item out of this what-if."),
]);

export type WhatIfChange = z.infer<typeof WHAT_IF_CHANGE_SCHEMA>;

export const WHAT_IF_CHANGE_TYPES: string[] = WHAT_IF_CHANGE_SCHEMA.options.map(
  (o) => o.shape.type.value,
);

const TARGET_SUCCESS = z
  .number()
  .min(0.5)
  .max(0.99)
  .describe("Target probability of success as a fraction, e.g. 0.85.");

export const SOLVE_FOR_SCHEMA = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("max_spending"), targetSuccess: TARGET_SUCCESS })
    .describe("The most they can spend each year in retirement (today's dollars) and still hit the target."),
  z
    .object({ kind: z.literal("retirement_age"), person: PERSON, targetSuccess: TARGET_SUCCESS })
    .describe("The retirement age at which the plan reaches the target."),
  z
    .object({ kind: z.literal("savings"), accountId: ID, targetSuccess: TARGET_SUCCESS })
    .describe("The annual savings into one account (which must have a savings rule) needed to reach the target."),
  z
    .object({
      kind: z.literal("roth_amount"),
      changeIndex: z.number().int().min(0),
      targetSuccess: TARGET_SUCCESS,
    })
    .describe(
      "For the fixed_amount roth_conversion change at changeIndex (0-based, counted within this variation's own changes): the annual amount that reaches the target.",
    ),
  z
    .object({ kind: z.literal("ss_claim_age"), person: PERSON })
    .describe("The Social Security claim age, 62–70, that leaves the largest portfolio at the end of the plan. No Monte Carlo."),
]);

export type SolveFor = z.infer<typeof SOLVE_FOR_SCHEMA>;
