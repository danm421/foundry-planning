import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID format");

const base = {
  year: z.number().int().gte(1900).lte(2200),
  amount: z.number().gt(0),
  grantor: z.enum(["client", "spouse", "joint"]),
  recipientEntityId: uuidSchema.optional().nullable(),
  recipientFamilyMemberId: uuidSchema.optional().nullable(),
  recipientExternalBeneficiaryId: uuidSchema.optional().nullable(),
  useCrummeyPowers: z.boolean().optional().default(false),
  notes: z.string().trim().nullish(),
};

function exactlyOneRecipient(d: {
  recipientEntityId?: string | null;
  recipientFamilyMemberId?: string | null;
  recipientExternalBeneficiaryId?: string | null;
}): boolean {
  const count = [
    d.recipientEntityId,
    d.recipientFamilyMemberId,
    d.recipientExternalBeneficiaryId,
  ].filter((x) => x != null).length;
  return count === 1;
}

export const giftCreateSchema = z.object(base).superRefine((d, ctx) => {
  if (!exactlyOneRecipient(d)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Exactly one of recipientEntityId, recipientFamilyMemberId, or recipientExternalBeneficiaryId must be set.",
    });
  }
});

export const giftUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as Record<string, z.ZodTypeAny>,
  )
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

export type GiftCreateInput = z.infer<typeof giftCreateSchema>;
export type GiftUpdateInput = z.infer<typeof giftUpdateSchema>;
