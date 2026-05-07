import { z } from "zod";

export const TRUST_TERM_TYPES = [
  "years",
  "single_life",
  "joint_life",
  "shorter_of_years_or_life",
] as const;

export const TRUST_PAYOUT_TYPES = ["unitrust", "annuity"] as const;

export const TRUST_SPLIT_INTEREST_ORIGINS = ["new", "existing"] as const;

const uuid = z.string().uuid();

export const trustSplitInterestSchema = z
  .object({
    /**
     * Whether this CLUT is being funded in this plan ('new') or was funded
     * historically before plan start ('existing'). Defaults to 'new'.
     *  - new: API computes income/remainder from inputs and auto-emits the
     *    remainder-interest gift on save.
     *  - existing: caller supplies originalIncomeInterest +
     *    originalRemainderInterest (the values recorded on the historical
     *    return); API skips both the recompute and the gift auto-emit.
     */
    origin: z.enum(TRUST_SPLIT_INTEREST_ORIGINS).optional(),
    inceptionYear: z.number().int().min(1900).max(2200),
    inceptionValue: z.number().nonnegative(),
    payoutType: z.enum(TRUST_PAYOUT_TYPES),
    payoutPercent: z.number().min(0).max(1).optional(),
    payoutAmount: z.number().nonnegative().optional(),
    irc7520Rate: z.number().min(0).max(1),
    termType: z.enum(TRUST_TERM_TYPES),
    termYears: z.number().int().positive().optional(),
    measuringLife1Id: uuid.optional(),
    measuringLife2Id: uuid.optional(),
    charityId: uuid,
    /** Required when origin = 'existing'. Ignored otherwise. */
    originalIncomeInterest: z.number().nonnegative().optional(),
    /** Required when origin = 'existing'. Ignored otherwise. */
    originalRemainderInterest: z.number().nonnegative().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.payoutType === "unitrust") {
      if (d.payoutPercent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payoutPercent"],
          message: "payoutPercent is required when payoutType = 'unitrust'",
        });
      }
      if (d.payoutAmount != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payoutAmount"],
          message: "payoutAmount must be omitted when payoutType = 'unitrust'",
        });
      }
    } else if (d.payoutType === "annuity") {
      if (d.payoutAmount == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payoutAmount"],
          message: "payoutAmount is required when payoutType = 'annuity'",
        });
      }
      if (d.payoutPercent != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payoutPercent"],
          message: "payoutPercent must be omitted when payoutType = 'annuity'",
        });
      }
    }

    const needsYears =
      d.termType === "years" || d.termType === "shorter_of_years_or_life";
    const needsLife =
      d.termType === "single_life" ||
      d.termType === "joint_life" ||
      d.termType === "shorter_of_years_or_life";

    if (needsYears && d.termYears == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["termYears"],
        message: `termYears is required for termType = '${d.termType}'`,
      });
    }
    if (!needsYears && d.termYears != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["termYears"],
        message: `termYears must be omitted for termType = '${d.termType}'`,
      });
    }

    if (needsLife && d.measuringLife1Id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measuringLife1Id"],
        message: `measuringLife1Id is required for termType = '${d.termType}'`,
      });
    }
    if (d.termType === "joint_life" && d.measuringLife2Id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measuringLife2Id"],
        message: "measuringLife2Id is required for termType = 'joint_life'",
      });
    }
    if (d.termType !== "joint_life" && d.measuringLife2Id != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["measuringLife2Id"],
        message: "measuringLife2Id is only allowed for termType = 'joint_life'",
      });
    }

    if (d.origin === "existing") {
      if (d.originalIncomeInterest == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["originalIncomeInterest"],
          message:
            "originalIncomeInterest is required when origin = 'existing' (enter the value recorded on the historical return)",
        });
      }
      if (d.originalRemainderInterest == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["originalRemainderInterest"],
          message:
            "originalRemainderInterest is required when origin = 'existing' (enter the value recorded on the historical return)",
        });
      }
    }
  });

export type TrustSplitInterestInput = z.infer<typeof trustSplitInterestSchema>;
