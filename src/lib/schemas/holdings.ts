import { z } from "zod";
import { uuidLike } from "./common";
import {
  HOLDINGS_IMPORT_SOURCES,
  MAX_IMPORT_HOLDINGS,
  MAX_NAME,
  MAX_TICKER,
} from "@/lib/investments/holdings-import";

export const holdingCreateSchema = z
  .object({
    securityId: uuidLike.nullish(),
    displayTicker: z.string().trim().min(1).max(MAX_TICKER).nullish(),
    displayName: z.string().trim().max(MAX_NAME).nullish(),
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

/** One position of a Holdings-tab import — `ImportHolding`, as the read routes returned it. */
const importHoldingSchema = z
  .object({
    ticker: z.string().trim().toUpperCase().min(1).max(MAX_TICKER).optional(),
    name: z.string().trim().min(1).max(MAX_NAME).optional(),
    shares: z.number().min(0).optional(),
    price: z.number().min(0).optional(),
    marketValue: z.number().min(0).optional(),
    costBasis: z.number().min(0).optional(),
  })
  .strict()
  .refine((h) => h.ticker != null || h.name != null, { message: "Each holding needs a ticker or a name" });

export const holdingsImportSchema = z
  .object({
    source: z.enum(HOLDINGS_IMPORT_SOURCES),
    mode: z.enum(["replace", "append"]),
    holdings: z.array(importHoldingSchema).min(1).max(MAX_IMPORT_HOLDINGS),
  })
  .strict();

export const holdingsStatementReadSchema = z
  .object({
    stagedPathname: z.string().min(1).max(512),
    filename: z.string().trim().min(1).max(255),
  })
  .strict();

export type HoldingCreateBody = z.infer<typeof holdingCreateSchema>;
export type HoldingUpdateBody = z.infer<typeof holdingUpdateSchema>;
export type HoldingOverrideBody = z.infer<typeof holdingOverrideSchema>;
export type ClassifyTickerBody = z.infer<typeof classifyTickerSchema>;
