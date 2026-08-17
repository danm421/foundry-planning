import { z } from "zod";
import { uuidSchema, isoDate } from "./common";
import { strictPartial } from "./strict-partial";

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

/**
 * A timing choice and the field it depends on have to arrive together.
 *
 * A blank companion never failed — it fell through to a default that inverted
 * the strategy. Measured on the real engine: "hold, then sell in <blank>"
 * liquidates the entire position in the vest year (`sellYear ?? acquisitionYear`
 * in `timeline.ts`), and "sell <blank>% per year" emits no sell at all
 * (`pct <= 0` returns an empty list), so the shares are held forever. A blank
 * exercise year on "specific year" silently means "at vest". Audit F29/F40.
 *
 * `sellStartYear` is deliberately NOT required: blank falls back to the
 * acquisition year, which is what "start selling once I have them" means.
 */
interface StrategyCompanionInput {
  exerciseTiming?: string | null;
  exerciseYear?: number | null;
  sellTiming?: string | null;
  sellYear?: number | null;
  sellPercentPerYear?: number | null;
}

function addStrategyCompanionIssues(
  v: StrategyCompanionInput,
  ctx: z.RefinementCtx,
  keys: { exerciseYear: string; sellYear: string; sellPercentPerYear: string },
  at: (string | number)[] = [],
): void {
  if (v.exerciseTiming === "specific_year" && v.exerciseYear == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...at, keys.exerciseYear],
      message: "An exercise year is required when exercise timing is a specific year.",
    });
  }
  if (v.sellTiming === "hold_then_sell_year" && v.sellYear == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...at, keys.sellYear],
      message: "A sell year is required when sell timing is hold-then-sell.",
    });
  }
  if (v.sellTiming === "percent_per_year" && !(v.sellPercentPerYear != null && v.sellPercentPerYear > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...at, keys.sellPercentPerYear],
      message: "A sell percentage above zero is required when sell timing is percent-per-year.",
    });
  }
}

const ACCOUNT_STRATEGY_KEYS = {
  exerciseYear: "defaultExerciseYear",
  sellYear: "defaultSellYear",
  sellPercentPerYear: "defaultSellPercentPerYear",
};

const GRANT_STRATEGY_KEYS = {
  exerciseYear: "exerciseYear",
  sellYear: "sellYear",
  sellPercentPerYear: "sellPercentPerYear",
};

/** Read an account's `default*` strategy fields as a plain strategy triplet. */
function accountStrategy(a: {
  defaultExerciseTiming?: string | null;
  defaultExerciseYear?: number | null;
  defaultSellTiming?: string | null;
  defaultSellYear?: number | null;
  defaultSellPercentPerYear?: number | null;
}): StrategyCompanionInput {
  return {
    exerciseTiming: a.defaultExerciseTiming,
    exerciseYear: a.defaultExerciseYear,
    sellTiming: a.defaultSellTiming,
    sellYear: a.defaultSellYear,
    sellPercentPerYear: a.defaultSellPercentPerYear,
  };
}

export const stockOptionAccountCreateSchema = z
  .object(base)
  .superRefine((a, ctx) => addStrategyCompanionIssues(accountStrategy(a), ctx, ACCOUNT_STRATEGY_KEYS));

// `strictPartial`, not `.partial()` — Zod 4 keeps a `.default()` alive under
// `.optional()`. Every strategy field here is `.optional().default(...)`, so
// `.partial()` injected SEVEN keys, all of which the PATCH route writes through
// `input.X !== undefined` guards that an injected key always passes: a rename
// alone would zero the share price, reset withholding to 22%, and revert the
// account's exercise/sell strategy to at-vest/hold.
// The companion rule fires only when the PATCH actually names a timing field —
// an absent key is `undefined` and skips it, so a rename-only PATCH is
// unaffected. The form always sends the whole strategy block.
export const stockOptionAccountUpdateSchema = strictPartial(z.object(base)).superRefine((a, ctx) =>
  addStrategyCompanionIssues(accountStrategy(a), ctx, ACCOUNT_STRATEGY_KEYS),
);

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
  /** The REAL pre-plan acquisition of the shares this row has already acquired.
   *  Optional — an advisor may not have the client's exercise confirmation yet —
   *  and the engine's fallback for a blank is deliberately conservative rather
   *  than favourable. Audit F1/F2. */
  acquiredOn: isoDate.nullable().optional(),
  priceAtAcquisition: z.number().nonnegative().nullable().optional(),
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

/** Everything a grant body has to satisfy beyond field-level types. Shared by
 *  create and update, which differ only in how they treat `plannedEvents`. */
function refineGrant(
  g: Omit<z.infer<typeof grantBase>, "plannedEvents">,
  ctx: z.RefinementCtx,
): void {
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
  // (c) The vesting rows ARE the grant as far as the projection is concerned:
  // `buildGrantTimeline` iterates the tranches and never reads `sharesGranted`.
  // Nothing tied the two together, so a 10,000-share grant with one 4,000-share
  // row vested $200,000 of $500,000 while the vesting-schedule report kept
  // printing 10,000 granted / 10,000 unvested. Audit F39/F34.
  //
  // 83(b) is the one exception — the whole grant is acquired at the grant date,
  // and both the timeline and the vesting schedule read `sharesGranted` there.
  const wholeGrantAt83b = g.grantType === "rsu" && g.has83bElection;
  if (g.tranches.length === 0 && !wholeGrantAt83b) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tranches"],
      message: "At least one vesting tranche is required — the projection is built from the tranches.",
    });
  }
  if (g.tranches.length > 0) {
    const rowSum = g.tranches.reduce((acc, t) => acc + t.shares, 0);
    if (Math.abs(rowSum - g.sharesGranted) > 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tranches"],
        message: `Vesting tranches total ${rowSum} of ${g.sharesGranted} shares granted.`,
      });
    }
  }
  // (d) A timing choice and the field it depends on must arrive together, at
  // the grant level and on every tranche override. Audit F29/F40.
  addStrategyCompanionIssues(g, ctx, GRANT_STRATEGY_KEYS);

  // (e) Shares flow vested → exercised → sold, so each bucket has to fit inside
  // the one before it. `sharesExercised` and `sharesSold` were only checked for
  // non-negativity, so a 1,000-share row could carry 10,000 exercised and the
  // engine seeded all 10,000 as held stock. Audit F41.
  g.tranches.forEach((t, i) => {
    addStrategyCompanionIssues(t, ctx, GRANT_STRATEGY_KEYS, ["tranches", i]);
    const acquired = g.grantType === "rsu" ? t.shares : t.sharesExercised;
    if (g.grantType !== "rsu" && t.sharesExercised > t.shares) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tranches", i, "sharesExercised"],
        message: "sharesExercised cannot exceed the tranche's shares.",
      });
    }
    if (t.sharesSold > acquired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tranches", i, "sharesSold"],
        message:
          g.grantType === "rsu"
            ? "sharesSold cannot exceed the tranche's shares."
            : "sharesSold cannot exceed sharesExercised.",
      });
    }
    // (f) The acquisition facts have to be coherent, or the engine reads half a
    // fact. A price with no date cannot be used at all (the holding period is
    // unanswerable), and a date on a row that acquired nothing describes an
    // event that did not happen. Audit F1/F2.
    if (t.priceAtAcquisition != null && t.acquiredOn == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tranches", i, "acquiredOn"],
        message: "An acquisition date is required when a price at acquisition is given.",
      });
    }
    if (t.acquiredOn != null && acquired <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tranches", i, "acquiredOn"],
        message: "This row has no acquired shares, so it has no acquisition to date.",
      });
    }
    // ISO dates compare correctly as plain strings — the same property that lets
    // the engine's `dates.ts` stay on strings instead of `Date` objects.
    if (t.acquiredOn != null && t.acquiredOn < g.grantDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tranches", i, "acquiredOn"],
        message: "Shares cannot be acquired before the grant date.",
      });
    }
  });
}

export const grantCreateSchema = grantBase.superRefine(refineGrant);

/**
 * PUT is a full replacement for everything the editor sends — but an ABSENT
 * `plannedEvents` key means "leave them alone", not "delete them all".
 *
 * The grant editor cannot create planned events (no screen does), yet it sent
 * `plannedEvents: []` on every save and the route replaced the stored list with
 * it. Any event created through the API was wiped by the next visit to the
 * editor — and a grant on "manual" exercise timing depends entirely on those
 * events, so the whole grant was abandoned. Audit F18/F33.
 */
export const grantUpdateSchema = grantBase
  .extend({ plannedEvents: z.array(plannedEventSchema).optional() })
  .superRefine(refineGrant);

export type GrantCreateInput = z.infer<typeof grantCreateSchema>;
export type GrantUpdateInput = z.infer<typeof grantUpdateSchema>;
export type GrantTrancheInput = z.infer<typeof trancheSchema>;
export type GrantPlannedEventInput = z.infer<typeof plannedEventSchema>;
