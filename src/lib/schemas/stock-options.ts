import { z } from "zod";
import { uuidSchema } from "./common";

/**
 * Stock-option accounts — the top-level equity account that holds grants,
 * tranches, and planned events. One owner (client or spouse); extension row
 * lives in stock_option_accounts.
 */

const base = {
  // accounts row
  name: z.string().trim().min(1).max(200),
  growthRate: z.number().nullable().optional(),

  // Single-owner model — simpler than insurance's OwnerRef.
  owner: z.enum(["client", "spouse"]),

  // stock_option_accounts extension row
  ticker: z.string().trim().max(20).nullable().optional(),
  isPublic: z.boolean().optional().default(false),
  pricePerShare: z.number().nonnegative().optional().default(0),
  destinationAccountId: uuidSchema.nullable().optional(),
  autoCreateDestination: z.boolean().optional().default(true),
  sellToCover: z.boolean().optional().default(true),
  withholdingRate: z.number().gte(0).lte(1).optional().default(0.22),

  // Account-level default strategy fields
  defaultExerciseTiming: z
    .enum(["at_vest", "specific_year", "year_before_expiration", "manual"])
    .optional()
    .default("at_vest"),
  defaultExerciseYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  defaultSellTiming: z
    .enum(["immediately", "hold_then_sell_year", "percent_per_year", "hold"])
    .optional()
    .default("hold"),
  defaultSellYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  defaultSellPercentPerYear: z.number().gte(0).lte(1).nullable().optional(),
  defaultSellStartYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
};

export const stockOptionAccountCreateSchema = z.object(base);

export const stockOptionAccountUpdateSchema = z.object(base).partial();

export type StockOptionAccountCreateInput = z.infer<typeof stockOptionAccountCreateSchema>;
export type StockOptionAccountUpdateInput = z.infer<typeof stockOptionAccountUpdateSchema>;
