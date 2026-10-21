import { z } from "zod";
import { uuidSchema, valuationDiscount, year } from "./common";
import { YEAR_REFS } from "@/lib/milestones";
import {
  qcdAccountIdField,
  qcdAmountModeField,
  qcdAmountIssue,
  isHalfQcd,
  QCD_NEEDS_BOTH,
  QCD_MUST_BE_CHARITY,
  QCD_ONE_GIVER,
  QCD_NO_ANNUAL_EXCLUSION,
} from "./qcd-fields";

const yearRefSchema = z
  .enum(YEAR_REFS)
  .nullable()
  .optional();

function exactlyOneRecipient(d: {
  recipientEntityId?: string | null;
  recipientFamilyMemberId?: string | null;
  recipientExternalBeneficiaryId?: string | null;
}): boolean {
  return (
    [
      d.recipientEntityId,
      d.recipientFamilyMemberId,
      d.recipientExternalBeneficiaryId,
    ].filter((x) => x != null).length === 1
  );
}

export const giftSeriesSchema = z
  .object({
    grantor: z.enum(["client", "spouse", "joint"]),
    recipientEntityId: uuidSchema.optional().nullable(),
    recipientFamilyMemberId: uuidSchema.optional().nullable(),
    recipientExternalBeneficiaryId: uuidSchema.optional().nullable(),
    amountMode: z.enum(["fixed", "annual_exclusion"]).default("fixed"),
    startYear: year,
    startYearRef: yearRefSchema,
    endYear: year,
    endYearRef: yearRefSchema,
    // 0 is allowed only for a full-RMD QCD; the refine holds every other series to > 0.
    annualAmount: z.number().min(0),
    /** Valuation discount for the whole series, as a FRACTION (0.3 = 30%).
     *  Applied to each fanned-out yearly occurrence. See ./common. */
    valuationDiscount,
    inflationAdjust: z.boolean().default(false),
    useCrummeyPowers: z.boolean().default(false),
    notes: z.string().trim().nullish(),
    /** A QCD series: paid from this IRA straight to a public charity. Set
     *  together with `qcdAmountMode`, or both null/absent. Its `amountMode`
     *  (the gift-series column) is always "fixed". */
    qcdAccountId: qcdAccountIdField,
    qcdAmountMode: qcdAmountModeField,
  })
  .superRefine((d, ctx) => {
    if (!exactlyOneRecipient(d)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Exactly one of recipientEntityId, recipientFamilyMemberId, or recipientExternalBeneficiaryId must be set.",
      });
      return;
    }
    if (d.endYear < d.startYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endYear must be ≥ startYear",
      });
    }
    if (isHalfQcd(d)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NEEDS_BOTH });
      return;
    }
    if (d.qcdAccountId != null && d.qcdAmountMode != null) {
      if (d.recipientExternalBeneficiaryId == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_MUST_BE_CHARITY });
      }
      if (d.grantor === "joint") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_ONE_GIVER });
      }
      if (d.amountMode === "annual_exclusion") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NO_ANNUAL_EXCLUSION });
      }
      const amountIssue = qcdAmountIssue(d.qcdAmountMode, d.annualAmount);
      if (amountIssue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: amountIssue });
    } else if (d.annualAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "annualAmount must be greater than zero.",
      });
    }
  });

export type GiftSeriesInput = z.infer<typeof giftSeriesSchema>;

// Partial schema for PATCH — no cross-field refinement so .partial() works.
export const giftSeriesUpdateSchema = z
  .object({
    grantor: z.enum(["client", "spouse", "joint"]).optional(),
    recipientEntityId: uuidSchema.optional().nullable(),
    recipientFamilyMemberId: uuidSchema.optional().nullable(),
    recipientExternalBeneficiaryId: uuidSchema.optional().nullable(),
    amountMode: z.enum(["fixed", "annual_exclusion"]).optional(),
    startYear: year.optional(),
    startYearRef: yearRefSchema.optional(),
    endYear: year.optional(),
    endYearRef: yearRefSchema.optional(),
    // 0 is allowed only for a full-RMD QCD; the PATCH route checks the merged row.
    annualAmount: z.number().min(0).optional(),
    valuationDiscount,
    inflationAdjust: z.boolean().optional(),
    useCrummeyPowers: z.boolean().optional(),
    notes: z.string().trim().nullish(),
    qcdAccountId: qcdAccountIdField,
    qcdAmountMode: qcdAmountModeField,
  })
  .superRefine((d, ctx) => {
    const patch = d as {
      recipientEntityId?: string | null;
      recipientFamilyMemberId?: string | null;
      recipientExternalBeneficiaryId?: string | null;
    };

    const touchedRecipient =
      "recipientEntityId" in patch ||
      "recipientFamilyMemberId" in patch ||
      "recipientExternalBeneficiaryId" in patch;
    if (touchedRecipient && !exactlyOneRecipient(patch)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "When updating recipient fields, exactly one of the three must be non-null.",
      });
    }

    // Both QCD fields together; a single-field patch is checked against the
    // merged row by the PATCH route.
    const qcdPatch = d as { qcdAccountId?: string | null; qcdAmountMode?: string | null };
    if ("qcdAccountId" in qcdPatch && "qcdAmountMode" in qcdPatch && isHalfQcd(qcdPatch)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NEEDS_BOTH });
    }
    if (qcdPatch.qcdAccountId != null && d.amountMode === "annual_exclusion") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NO_ANNUAL_EXCLUSION });
    }
  });

export type GiftSeriesUpdate = z.infer<typeof giftSeriesUpdateSchema>;
