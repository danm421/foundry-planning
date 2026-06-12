import { z } from "zod";
import { uuidLike } from "./common";

export const holdingCreateSchema = z
  .object({
    securityId: uuidLike.nullish(),
    displayTicker: z.string().trim().min(1).max(32).nullish(),
    displayName: z.string().trim().max(200).nullish(),
    shares: z.number().min(0),
    price: z.number().min(0),
    priceAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    costBasis: z.number().min(0),
    marketValue: z.number().min(0).nullish(),
    sortOrder: z.number().int().min(0).optional(),
    notes: z.string().trim().max(1000).nullish(),
  })
  .strict();

export const holdingUpdateSchema = holdingCreateSchema.partial();

export const holdingOverrideSchema = z
  .object({
    overrides: z
      .array(
        z.object({ assetClassId: uuidLike, weight: z.number().min(0).max(1) }).strict(),
      )
      .max(100)
      .refine((arr) => arr.reduce((s, a) => s + a.weight, 0) <= 1.0001, {
        message: "Override weights total exceeds 1.0",
      }),
  })
  .strict();

export const classifyTickerSchema = z.object({ ticker: z.string().trim().min(1).max(32) }).strict();

// Query-param validation for GET /holdings/quote. Same shape as classify; named
// separately for intent (price lookup vs asset-class lookup).
export const quoteTickerSchema = classifyTickerSchema;
export type QuoteTickerQuery = z.infer<typeof quoteTickerSchema>;

export type HoldingCreateBody = z.infer<typeof holdingCreateSchema>;
export type HoldingUpdateBody = z.infer<typeof holdingUpdateSchema>;
export type HoldingOverrideBody = z.infer<typeof holdingOverrideSchema>;
export type ClassifyTickerBody = z.infer<typeof classifyTickerSchema>;
