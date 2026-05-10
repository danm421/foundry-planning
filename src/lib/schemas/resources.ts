import { z } from "zod";
import { money, growthRate, year, uuidLike } from "./common";

/**
 * Request-body schemas for the main resource endpoints. Each schema
 * uses `.passthrough()` at the leaves because drizzle silently drops
 * unknown columns, and we want the route to stay backwards-compatible
 * with ad-hoc fields the UI may pass. The schema's job here is:
 *
 *   (a) enforce presence of required identifiers,
 *   (b) reject types that will bomb downstream ("[object Object]"
 *       landing in a decimal column, NaN from Number("foo")),
 *   (c) cap array lengths so a malicious body can't allocate memory
 *       unboundedly before the handler fails elsewhere.
 *
 * These are intentionally narrower than the full Drizzle column types
 * — we're filtering at the boundary, not reproducing the schema.
 */

const filingStatusSchema = z.enum([
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
]);

const ownerSchema = z.enum(["client", "spouse", "joint"]);

export const clientCreateSchema = z
  .object({
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
    dateOfBirth: z.string().min(1).max(40),
    retirementAge: z.coerce.number().int().min(18).max(100),
    retirementMonth: z.coerce.number().int().min(1).max(12).optional(),
    lifeExpectancy: z.coerce.number().int().min(40).max(130),
    filingStatus: filingStatusSchema,
    spouseName: z.string().max(120).optional().nullable(),
    spouseLastName: z.string().max(120).optional().nullable(),
    spouseDob: z.string().max(40).optional().nullable(),
    spouseRetirementAge: z.coerce.number().int().min(18).max(100).optional().nullable(),
    spouseRetirementMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
    spouseLifeExpectancy: z.coerce.number().int().min(40).max(130).optional().nullable(),
    email: z.string().max(200).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    spouseEmail: z.string().max(200).optional().nullable(),
    spouseAddress: z.string().max(500).optional().nullable(),
  })
  .strict();

export const accountCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    category: z.string().min(1).max(40),
    subType: z.string().max(40).optional(),
    owner: ownerSchema.optional(),
    value: money.optional(),
    basis: money.optional(),
    growthRate: growthRate.optional().nullable(),
    rmdEnabled: z.boolean().optional(),
    priorYearEndValue: money.optional().nullable(),
    ownerEntityId: uuidLike.optional().nullable(),
    growthSource: z.string().max(40).optional(),
    modelPortfolioId: uuidLike.optional().nullable(),
    turnoverPct: money.optional(),
    overridePctOi: z.number().min(0).max(1).optional().nullable(),
    overridePctLtCg: z.number().min(0).max(1).optional().nullable(),
    overridePctQdiv: z.number().min(0).max(1).optional().nullable(),
    overridePctTaxExempt: z.number().min(0).max(1).optional().nullable(),
    annualPropertyTax: money.optional(),
    propertyTaxGrowthRate: growthRate.optional().nullable(),
  })
  .passthrough(); // prompts evolve; don't lock out novel fields

export const incomeCreateSchema = z
  .object({
    type: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    annualAmount: money.optional(),
    startYear: year,
    endYear: year,
    growthRate: growthRate.optional(),
    growthSource: z.string().max(40).optional(),
    owner: ownerSchema.optional(),
    claimingAge: z.coerce.number().int().min(0).max(100).optional().nullable(),
    ownerEntityId: uuidLike.optional().nullable(),
    cashAccountId: uuidLike.optional().nullable(),
    inflationStartYear: year.optional().nullable(),
  })
  .passthrough();

export const expenseCreateSchema = z
  .object({
    type: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    annualAmount: money.optional(),
    startYear: year,
    endYear: year,
    growthRate: growthRate.optional(),
    growthSource: z.string().max(40).optional(),
    ownerEntityId: uuidLike.optional().nullable(),
    cashAccountId: uuidLike.optional().nullable(),
    inflationStartYear: year.optional().nullable(),
  })
  .passthrough();

export const liabilityCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    balance: money.optional(),
    interestRate: growthRate.optional(),
    monthlyPayment: money.optional(),
    startYear: year,
    startMonth: z.coerce.number().int().min(1).max(12).optional(),
    termMonths: z.coerce.number().int().min(1).max(1200),
    termUnit: z.string().max(40).optional(),
    linkedPropertyId: uuidLike.optional().nullable(),
    ownerEntityId: uuidLike.optional().nullable(),
    isInterestDeductible: z.boolean().optional(),
  })
  .passthrough();
