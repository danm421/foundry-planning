// src/lib/life-insurance/schema.ts
//
// Zod schema for the Life Insurance straight-line solver request body,
// shared by the API route (`/api/clients/[id]/life-insurance/solve`) and
// the solver tab UI (Tasks 9–11). Keep it in sync with
// `LifeInsuranceAssumptions` in `@/lib/life-insurance/solve-need` —
// `LiAssumptions` is a structural superset (it adds `mcTargetScore`).
import { z } from "zod";

export const LI_ASSUMPTIONS_SCHEMA = z.object({
  deathYear: z.number().int().min(1900).max(2200),
  growthRate: z.number().min(0).max(0.2),
  leaveToHeirsAmount: z.number().min(0),
  finalExpenses: z.number().min(0),
  livingExpenseAtDeath: z.number().min(0).nullable(),
  payOffDebtsAtDeath: z.boolean(),
  mcTargetScore: z.number().min(0.01).max(0.99),
});

export type LiAssumptions = z.infer<typeof LI_ASSUMPTIONS_SCHEMA>;
