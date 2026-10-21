import { z } from "zod";
import { uuidSchema, valuationDiscount } from "./common";
import { strictPartial } from "./strict-partial";
import { YEAR_REFS } from "@/lib/milestones";
import {
  qcdAccountIdField,
  qcdAmountModeField,
  qcdAmountIssue,
  isHalfQcd,
  QCD_NEEDS_BOTH,
  QCD_MUST_BE_CHARITY,
  QCD_NO_TRANSFER,
  QCD_ONE_GIVER,
} from "./qcd-fields";

const yearRefSchema = z
  .enum(YEAR_REFS)
  .nullable()
  .optional();

const baseFields = {
  year: z.number().int().gte(1900).lte(2200),
  yearRef: yearRefSchema,
  // 0 is allowed only for a full-RMD QCD (the RMD sets the amount); every other
  // gift is held to > 0 in the refine below.
  amount: z.number().min(0).optional().nullable(),
  grantor: z.enum(["client", "spouse", "joint"]),
  recipientEntityId: uuidSchema.optional().nullable(),
  recipientFamilyMemberId: uuidSchema.optional().nullable(),
  recipientExternalBeneficiaryId: uuidSchema.optional().nullable(),
  accountId: uuidSchema.optional().nullable(),
  liabilityId: uuidSchema.optional().nullable(),
  percent: z.number().gt(0).lte(1).optional().nullable(),
  /** Valuation discount as a FRACTION (0.3 = 30%) — see `valuationDiscount` in
   *  ./common for the range and why its upper bound is 0.99995. Null/absent
   *  means no discount. Never folded into `amount` or `percent`. */
  valuationDiscount,
  parentGiftId: uuidSchema.optional().nullable(),
  useCrummeyPowers: z.boolean().optional().default(false),
  eventKind: z.enum(["outright", "clt_remainder_interest"]).optional().default("outright"),
  notes: z.string().trim().nullish(),
  /** A QCD: paid from this IRA straight to a public charity. Set together with
   *  `qcdAmountMode`, or both null/absent. */
  qcdAccountId: qcdAccountIdField,
  qcdAmountMode: qcdAmountModeField,
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
  if (isHalfQcd(d)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NEEDS_BOTH });
    return;
  }
  if (d.qcdAccountId != null && d.qcdAmountMode != null) {
    if (d.recipientExternalBeneficiaryId == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_MUST_BE_CHARITY });
    }
    if (isAssetOrLiabilityTransfer(d)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NO_TRANSFER });
    }
    if (d.grantor === "joint") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_ONE_GIVER });
    }
    const amountIssue = qcdAmountIssue(d.qcdAmountMode, d.amount);
    if (amountIssue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: amountIssue });
    return;
  }
  if (isAssetOrLiabilityTransfer(d)) {
    if (d.percent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "percent is required for asset/liability transfers.",
      });
    }
    if (d.amount != null && d.amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be greater than zero.",
      });
    }
  } else {
    // Cash gift
    if (d.amount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount is required for cash gifts.",
      });
    } else if (d.amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be greater than zero.",
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
//
// `strictPartial`, not a plain `.optional()` map — Zod 4 keeps a `.default()`
// alive under `.optional()`, so this shape injected `useCrummeyPowers: false`
// (which the route writes through an `!== undefined` guard, clearing the
// Crummey election on an ILIT funding gift) and `eventKind: "outright"`.
export const giftUpdateSchema = strictPartial(
  z.object(baseFields).omit({
    parentGiftId: true,
    accountId: true,
    liabilityId: true,
  }),
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

    // Both QCD fields together (set both, or null both to switch back to cash).
    // A patch of ONE field is legal — e.g. only the amount mode of an existing
    // QCD — so only a null/value split is rejected here; the write checks the
    // merged row (updateGiftForClient).
    const qcdPatch = d as { qcdAccountId?: string | null; qcdAmountMode?: string | null };
    if (
      "qcdAccountId" in qcdPatch &&
      "qcdAmountMode" in qcdPatch &&
      isHalfQcd(qcdPatch)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: QCD_NEEDS_BOTH });
    }
  });

export type GiftCreateInput = z.infer<typeof giftCreateSchema>;
export type GiftUpdateInput = z.infer<typeof giftUpdateSchema>;
