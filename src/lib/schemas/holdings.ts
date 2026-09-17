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

/** Below this, EODHD's `/search` answers with noise — one letter matches
 *  hundreds of listings and no advisor can pick among them. Lives here, the
 *  dependency-free leaf, so the route boundary and the search itself can't
 *  drift apart. (The picker restates it client-side; see MIN_QUERY.) */
export const MIN_SEARCH_QUERY = 2;

// Query-param validation for GET /holdings/search — free text, so it takes a
// security NAME as readily as a symbol and is sized for the longer of the two.
export const securitySearchSchema = z
  .object({ q: z.string().trim().min(MIN_SEARCH_QUERY).max(120) })
  .strict();
export type SecuritySearchQuery = z.infer<typeof securitySearchSchema>;

export type HoldingCreateBody = z.infer<typeof holdingCreateSchema>;
export type HoldingUpdateBody = z.infer<typeof holdingUpdateSchema>;
export type HoldingOverrideBody = z.infer<typeof holdingOverrideSchema>;
export type ClassifyTickerBody = z.infer<typeof classifyTickerSchema>;
