import { z } from "zod";
import { uuidSchema, year } from "./common";

export const giftSeriesSchema = z
  .object({
    grantor: z.enum(["client", "spouse"]),
    recipientEntityId: uuidSchema,
    startYear: year,
    endYear: year,
    annualAmount: z.number().gt(0),
    inflationAdjust: z.boolean().default(false),
  })
  .refine((d) => d.endYear >= d.startYear, {
    message: "endYear must be ≥ startYear",
  });

export type GiftSeriesInput = z.infer<typeof giftSeriesSchema>;
