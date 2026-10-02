import { z } from "zod";

const PERSON = z.enum(["client", "spouse"]);
const CARE_SETTING = z.enum([
  "in_home",
  "assisted_living",
  "nursing_semi_private",
  "nursing_private",
  "custom",
]);

export const ltcCarePersonSchema = z.object({
  person: PERSON,
  startAge: z.number().int().min(0).max(120),
  years: z.number().int().min(1).max(30),
  careSetting: CARE_SETTING,
  annualCost: z.number().min(0),
  costInflation: z.number().min(0).max(0.15),
});

export const ltcHomeSaleSchema = z.object({
  accountId: z.string().min(1),
  saleYear: z.number().int().min(1900).max(2200),
  price: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("projected") }),
    z.object({ mode: z.literal("custom"), amount: z.number().positive() }),
  ]),
  sellingCostPct: z.number().min(0).max(0.2),
});

/** Plan-independent shape checks only. Checks that need the plan (a start
 *  year before plan start, a spouse with no date of birth, a sold home) are
 *  `resolveLtcEvent` warnings — see src/engine/ltc-event.ts. */
export const ltcEventSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  people: z
    .array(ltcCarePersonSchema)
    .min(1)
    .max(2)
    .refine((p) => new Set(p.map((x) => x.person)).size === p.length, {
      message: "Each person can be in care only once",
    }),
  livingExpenseCutPct: z.number().min(0).max(1).nullable(),
  homeSale: ltcHomeSaleSchema.nullable(),
  includePolicies: z.boolean(),
});
