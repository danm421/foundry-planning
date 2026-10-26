// src/lib/presentations/pages/life-insurance-summary/options-schema.ts
import { z } from "zod";

// The injected solve results (computed client-side in the launcher pre-solve
// phase and carried in the request body). Optional/nullable so a deck saved
// before solving still validates; the view-model treats null as "not solved".
const liSolvedMcSchema = z.object({
  status: z.enum(["solved", "exceeds-cap"]),
  faceValue: z.number(),
  achievedScore: z.number(),
});

export const liSolvedSchema = z.object({
  curveRows: z.array(
    z.object({
      year: z.number(),
      clientNeed: z.number(),
      spouseNeed: z.number().nullable(),
    }),
  ),
  mcClient: liSolvedMcSchema,
  mcSpouse: liSolvedMcSchema.nullable(),
  // Per-decedent estate-tax addend (federal + state estate tax + IRD) folded
  // into the solve target when "Cover estate taxes" is on; null when the
  // toggle is off — and on payloads produced before this field existed.
  estateTaxAddendClient: z.number().nullable().default(null),
  estateTaxAddendSpouse: z.number().nullable().default(null),
  assumptions: z.object({
    deathYear: z.number(),
    modelPortfolioLabel: z.string(),
    mcTargetScore: z.number(),
  }),
});

export const lifeInsuranceSummaryOptionsSchema = z.object({
  // Solve inputs (mirror LiAssumptions; surfaced by the OptionsControl).
  deathYear: z.number().int().min(1900).max(2200).default(() => new Date().getFullYear()),
  modelPortfolioId: z.string().uuid().nullable().default(null),
  mcTargetScore: z.number().min(0.01).max(0.99).default(0.85),
  leaveToHeirsAmount: z.number().min(0).default(0),
  livingExpenseAtDeath: z.number().min(0).nullable().default(null),
  payoffLiabilityIds: z.array(z.string()).default([]),
  coverEstateTaxes: z.boolean().default(false),
  // Injected results.
  solved: liSolvedSchema.nullable().default(null),
});

export type LifeInsuranceSummaryOptions = z.infer<
  typeof lifeInsuranceSummaryOptionsSchema
>;
export type LiSolved = z.infer<typeof liSolvedSchema>;

// A new page solves for death in the current calendar year at an 85% Monte Carlo
// target; the advisor can change either in the page's OptionsControl.
export const LIFE_INSURANCE_SUMMARY_OPTIONS_DEFAULT: LifeInsuranceSummaryOptions = {
  deathYear: new Date().getFullYear(),
  modelPortfolioId: null,
  mcTargetScore: 0.85,
  leaveToHeirsAmount: 0,
  livingExpenseAtDeath: null,
  payoffLiabilityIds: [],
  coverEstateTaxes: false,
  solved: null,
};
