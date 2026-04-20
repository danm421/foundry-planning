import { z } from "zod";
import { growthRate } from "./common";

// Fractional percent expressed as decimal (0..1).
const pct = z.number().min(0).max(1);

export const assetClassPutSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z.string().max(50).optional(),
    assetType: z.string().max(40).optional(),
    geometricReturn: growthRate.optional(),
    arithmeticMean: growthRate.optional(),
    volatility: z.number().min(0).max(2).optional(),
    pctOrdinaryIncome: pct.optional(),
    pctLtCapitalGains: pct.optional(),
    pctQualifiedDividends: pct.optional(),
    description: z.string().max(2000).optional().nullable(),
  })
  .strict();

export type AssetClassPutBody = z.infer<typeof assetClassPutSchema>;
