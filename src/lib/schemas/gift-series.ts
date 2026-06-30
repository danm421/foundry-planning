import { z } from "zod";
import { uuidSchema, year } from "./common";
import { YEAR_REFS } from "@/lib/milestones";

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
    annualAmount: z.number().gt(0),
    inflationAdjust: z.boolean().default(false),
    useCrummeyPowers: z.boolean().default(false),
    notes: z.string().trim().nullish(),
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
    annualAmount: z.number().gt(0).optional(),
    inflationAdjust: z.boolean().optional(),
    useCrummeyPowers: z.boolean().optional(),
    notes: z.string().trim().nullish(),
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
  });

export type GiftSeriesUpdate = z.infer<typeof giftSeriesUpdateSchema>;
