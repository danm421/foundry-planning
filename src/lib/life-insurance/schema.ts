// src/lib/life-insurance/schema.ts
//
// Zod schema for the Life Insurance straight-line solver request body,
// shared by the API route (`/api/clients/[id]/life-insurance/solve`) and
// the solver tab UI. `LiAssumptions` is the wire/UI shape; the routes
// transform it into the engine's `LifeInsuranceAssumptions`
// (`@/lib/life-insurance/solve-need`) by resolving `modelPortfolioId` into
// concrete proceeds growth via `loadLiProceedsGrowth`.
//
// `LiAssumptions` now carries `modelPortfolioId` (which portfolio to use
// for the survivor's projected growth) and `payoffLiabilityIds` (debts to
// extinguish at death). The old `growthRate`, `finalExpenses`, and
// `payOffDebtsAtDeath` boolean have been removed.
import { z } from "zod";

export const LI_ASSUMPTIONS_SCHEMA = z.object({
  deathYear: z.number().int().min(1900).max(2200),
  modelPortfolioId: z.string().uuid().nullable(),
  leaveToHeirsAmount: z.number().min(0),
  livingExpenseAtDeath: z.number().min(0).nullable(),
  payoffLiabilityIds: z.array(z.string()),
  mcTargetScore: z.number().min(0.01).max(0.99),
});

export type LiAssumptions = z.infer<typeof LI_ASSUMPTIONS_SCHEMA>;
