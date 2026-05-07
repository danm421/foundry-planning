import { z } from "zod";
import { growthRate } from "./common";

// Numeric string from a form input or a parsed number. Mirrors finiteNumber
// in common.ts — the CMA UI stores edited values as strings, so the API
// must coerce on the way in.
const numeric = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Must be a finite number" });
      return z.NEVER;
    }
    return n;
  });

// Fractional percent expressed as decimal (0..1).
const pct = numeric.refine((n) => n >= 0 && n <= 1, "Must be between 0 and 1");
const volatility = numeric.refine((n) => n >= 0 && n <= 2, "Must be between 0 and 2");

export const assetClassPutSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z.string().max(50).optional(),
    assetType: z.string().max(40).optional(),
    geometricReturn: growthRate.optional(),
    arithmeticMean: growthRate.optional(),
    volatility: volatility.optional(),
    pctOrdinaryIncome: pct.optional(),
    pctLtCapitalGains: pct.optional(),
    pctQualifiedDividends: pct.optional(),
    pctTaxExempt: pct.optional(),
    sortOrder: z.number().int().optional(),
    description: z.string().max(2000).optional().nullable(),
  })
  .strict();

export type AssetClassPutBody = z.infer<typeof assetClassPutSchema>;
