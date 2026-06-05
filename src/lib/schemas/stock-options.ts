import { z } from "zod";
import { uuidSchema, isoDate } from "./common";

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

// ---------------------------------------------------------------------------
// Grant-level strategy override fields (shared by grant + tranche schemas)
// ---------------------------------------------------------------------------
const strategyFields = {
  exerciseTiming: z
    .enum(["at_vest", "specific_year", "year_before_expiration", "manual"])
    .nullable()
    .optional(),
  exerciseYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  sellTiming: z
    .enum(["immediately", "hold_then_sell_year", "percent_per_year", "hold"])
    .nullable()
    .optional(),
  sellYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  sellPercentPerYear: z.number().gte(0).lte(1).nullable().optional(),
  sellStartYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
};

// ---------------------------------------------------------------------------
// Vest tranche sub-schema
// ---------------------------------------------------------------------------
const trancheSchema = z.object({
  vestDate: isoDate,
  shares: z.number().nonnegative(),
  sharesExercised: z.number().nonnegative().optional().default(0),
  sharesSold: z.number().nonnegative().optional().default(0),
  ...strategyFields,
});

// ---------------------------------------------------------------------------
// Planned event sub-schema
// v1: planned events are grant-level; trancheId omitted (deferred to a later task).
// ---------------------------------------------------------------------------
const plannedEventSchema = z.object({
  year: z.number().int().gte(1900).lte(2200),
  action: z.enum(["exercise", "sell"]),
  shares: z.number().nonnegative().nullable().optional(),
  pct: z.number().gte(0).lte(1).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Grant create schema
// ---------------------------------------------------------------------------
const grantBase = z.object({
  grantNumber: z.string().trim().max(100).nullable().optional(),
  grantType: z.enum(["rsu", "nqso", "iso"]),
  grantDate: isoDate,
  sharesGranted: z.number().nonnegative(),
  has83bElection: z.boolean().optional().default(false),
  fmvAtGrant: z.number().nonnegative().nullable().optional(),
  strikePrice: z.number().nonnegative().nullable().optional(),
  strikeDiscountPct: z.number().gte(0).lte(1).nullable().optional(),
  expirationDate: isoDate.nullable().optional(),
  ...strategyFields,
  notes: z.string().trim().max(2000).nullable().optional(),
  tranches: z.array(trancheSchema).optional().default([]),
  plannedEvents: z.array(plannedEventSchema).optional().default([]),
});

export const grantCreateSchema = grantBase.superRefine((g, ctx) => {
  // (a) fmvAtGrant required when has83bElection is true
  if (g.has83bElection && g.fmvAtGrant == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fmvAtGrant"],
      message: "fmvAtGrant is required when has83bElection is true.",
    });
  }
  // (b) nqso/iso: at least one of strikePrice/strikeDiscountPct required, AND expirationDate required
  if (g.grantType === "nqso" || g.grantType === "iso") {
    if (g.strikePrice == null && g.strikeDiscountPct == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["strikePrice"],
        message: "At least one of strikePrice or strikeDiscountPct is required for nqso/iso grants.",
      });
    }
    if (g.expirationDate == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expirationDate"],
        message: "expirationDate is required for nqso/iso grants.",
      });
    }
  }
});

// PUT reuses the same full-replacement schema (not partial).
export const grantUpdateSchema = grantCreateSchema;

export type GrantCreateInput = z.infer<typeof grantCreateSchema>;
export type GrantUpdateInput = z.infer<typeof grantUpdateSchema>;
export type GrantTrancheInput = z.infer<typeof trancheSchema>;
export type GrantPlannedEventInput = z.infer<typeof plannedEventSchema>;
