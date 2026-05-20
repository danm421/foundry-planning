import { z } from "zod";
import { uuidSchema } from "./common";
import { YEAR_REFS } from "@/lib/milestones";

/**
 * Notes receivable (a.k.a. installment notes) — the lender-side counterpart to
 * liabilities. Owners are family members, entities, or external beneficiaries
 * (exactly one per row, mirrored by a CHECK in `note_receivable_owners`).
 *
 * Extra payments piggyback on the same per-payment / lump-sum semantics as
 * liability extra payments.
 */

const yearRefSchema = z.enum(YEAR_REFS).nullable().optional();

const ownerSchema = z
  .object({
    familyMemberId: uuidSchema.optional().nullable(),
    entityId: uuidSchema.optional().nullable(),
    externalBeneficiaryId: uuidSchema.optional().nullable(),
    // Percent of the note owed to this party. Stored 0-100 to match the
    // beneficiaries/wills convention; DB column is decimal(6,4) and routes
    // convert when persisting.
    percent: z.number().gte(0).lte(100),
  })
  .superRefine((o, ctx) => {
    const set = [o.familyMemberId, o.entityId, o.externalBeneficiaryId].filter(
      (x) => x != null,
    );
    if (set.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Exactly one of familyMemberId, entityId, externalBeneficiaryId is required.",
      });
    }
  });

const extraPaymentSchema = z.object({
  year: z.number().int().gte(1900).lte(2200),
  type: z.enum(["per_payment", "lump_sum"]),
  amount: z.number().nonnegative(),
});

const base = {
  name: z.string().trim().min(1).max(200),
  faceValue: z.number().positive(),
  basis: z.number().nonnegative(),
  asOfBalance: z.number().nonnegative().nullable().optional(),
  balanceAsOfMonth: z.number().int().min(1).max(12).nullable().optional(),
  balanceAsOfYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  interestRate: z.number().gte(0),
  paymentType: z.enum(["amortizing", "interest_only_balloon"]),
  monthlyPayment: z.number().nonnegative().nullable().optional(),
  startYear: z.number().int().gte(1900).lte(2200),
  startMonth: z.number().int().min(1).max(12).default(1),
  startYearRef: yearRefSchema,
  termMonths: z.number().int().positive(),
  linkedTrustEntityId: uuidSchema.nullable().optional(),
  owners: z.array(ownerSchema).min(1),
  extraPayments: z.array(extraPaymentSchema).optional().default([]),
};

export const noteReceivableCreateSchema = z.object(base);

export const noteReceivableUpdateSchema = z.object(
  Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
  ) as Record<string, z.ZodTypeAny>,
);

export const noteReceivableExtraPaymentsReplaceSchema = z.array(extraPaymentSchema);

export type NoteReceivableCreateInput = z.infer<typeof noteReceivableCreateSchema>;
export type NoteReceivableUpdateInput = z.infer<typeof noteReceivableUpdateSchema>;
export type NoteReceivableOwnerInput = z.infer<typeof ownerSchema>;
export type NoteReceivableExtraPaymentInput = z.infer<typeof extraPaymentSchema>;
