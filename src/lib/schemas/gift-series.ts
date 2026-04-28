import { z } from "zod";
import { uuidSchema, year } from "./common";
import { YEAR_REFS } from "@/lib/milestones";

const yearRefSchema = z
  .enum(YEAR_REFS)
  .nullable()
  .optional();

export const giftSeriesSchema = z
  .object({
    grantor: z.enum(["client", "spouse"]),
    recipientEntityId: uuidSchema,
    startYear: year,
    startYearRef: yearRefSchema,
    endYear: year,
    endYearRef: yearRefSchema,
    annualAmount: z.number().gt(0),
    inflationAdjust: z.boolean().default(false),
    useCrummeyPowers: z.boolean().default(false),
    notes: z.string().trim().nullish(),
  })
  .refine((d) => d.endYear >= d.startYear, {
    message: "endYear must be ≥ startYear",
  });

export type GiftSeriesInput = z.infer<typeof giftSeriesSchema>;

// Partial schema for PATCH — no cross-field refinement so .partial() works.
export const giftSeriesUpdateSchema = z.object({
  grantor: z.enum(["client", "spouse"]).optional(),
  recipientEntityId: uuidSchema.optional(),
  startYear: year.optional(),
  startYearRef: yearRefSchema.optional(),
  endYear: year.optional(),
  endYearRef: yearRefSchema.optional(),
  annualAmount: z.number().gt(0).optional(),
  inflationAdjust: z.boolean().optional(),
  useCrummeyPowers: z.boolean().optional(),
  notes: z.string().trim().nullish(),
});

export type GiftSeriesUpdate = z.infer<typeof giftSeriesUpdateSchema>;
