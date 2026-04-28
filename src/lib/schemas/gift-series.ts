import { z } from "zod";
import { uuidSchema, year } from "./common";

const yearRefSchema = z
  .enum([
    "client_retire",
    "spouse_retire",
    "client_death",
    "spouse_death",
    "survivorship",
    "today",
  ])
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
