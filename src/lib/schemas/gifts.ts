import { z } from "zod";
import { uuidSchema } from "./common";
import { YEAR_REFS } from "@/lib/milestones";

const yearRefSchema = z
  .enum(YEAR_REFS)
  .nullable()
  .optional();

const baseFields = {
  year: z.number().int().gte(1900).lte(2200),
  yearRef: yearRefSchema,
  amount: z.number().gt(0).optional().nullable(),
  grantor: z.enum(["client", "spouse", "joint"]),
  recipientEntityId: uuidSchema.optional().nullable(),
  recipientFamilyMemberId: uuidSchema.optional().nullable(),
  recipientExternalBeneficiaryId: uuidSchema.optional().nullable(),
  accountId: uuidSchema.optional().nullable(),
  liabilityId: uuidSchema.optional().nullable(),
  percent: z.number().gt(0).lte(1).optional().nullable(),
  parentGiftId: uuidSchema.optional().nullable(),
  useCrummeyPowers: z.boolean().optional().default(false),
  notes: z.string().trim().nullish(),
};

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

function isAssetOrLiabilityTransfer(d: {
  accountId?: string | null;
  liabilityId?: string | null;
}): boolean {
  return d.accountId != null || d.liabilityId != null;
}

export const giftCreateSchema = z.object(baseFields).superRefine((d, ctx) => {
  if (!exactlyOneRecipient(d)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Exactly one of recipientEntityId, recipientFamilyMemberId, or recipientExternalBeneficiaryId must be set.",
    });
    return;
  }
  if (d.accountId != null && d.liabilityId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Gift cannot reference both accountId and liabilityId.",
    });
    return;
  }
  if (isAssetOrLiabilityTransfer(d)) {
    if (d.percent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "percent is required for asset/liability transfers.",
      });
    }
  } else {
    // Cash gift
    if (d.amount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount is required for cash gifts.",
      });
    }
    if (d.percent != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "percent is only valid for asset/liability transfers.",
      });
    }
  }
});

// Identity fields set at creation time. Re-parenting or swapping the underlying
// account/liability would break the bundling contract (parent + child rows
// pointing at related FK targets), so the update schema refuses these.
const IMMUTABLE_AFTER_CREATE = [
  "parentGiftId",
  "accountId",
  "liabilityId",
] as const;

export const giftUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(baseFields)
        .filter(
          ([k]) =>
            !(
              IMMUTABLE_AFTER_CREATE as readonly string[]
            ).includes(k),
        )
        .map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as Record<string, z.ZodTypeAny>,
  )
  .superRefine((d, ctx) => {
    const patch = d as {
      recipientEntityId?: string | null;
      recipientFamilyMemberId?: string | null;
      recipientExternalBeneficiaryId?: string | null;
      amount?: number | null;
      percent?: number | null;
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

export type GiftCreateInput = z.infer<typeof giftCreateSchema>;
export type GiftUpdateInput = z.infer<typeof giftUpdateSchema>;
