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
    age: z.number().int().min(60).max(120),
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
]);

export type SolverMutationFromSchema = z.infer<typeof SOLVER_MUTATION_SCHEMA>;
