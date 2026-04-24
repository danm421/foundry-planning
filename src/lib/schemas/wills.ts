import { z } from "zod";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID format");

export const willBequestRecipientSchema = z
  .object({
    recipientKind: z.enum([
      "family_member",
      "external_beneficiary",
      "entity",
      "spouse",
    ]),
    recipientId: uuidSchema.nullable(),
    percentage: z.number().gt(0).lte(100),
    sortOrder: z.number().int().min(0),
  })
  .superRefine((r, ctx) => {
    const isSpouse = r.recipientKind === "spouse";
    if (isSpouse && r.recipientId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recipientId must be null when recipientKind='spouse'",
      });
    }
    if (!isSpouse && r.recipientId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recipientId is required when recipientKind is not 'spouse'",
      });
    }
  });

export const willBequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    assetMode: z.enum(["specific", "all_assets"]),
    accountId: uuidSchema.nullable(),
    percentage: z.number().gt(0).lte(100),
    condition: z.enum([
      "if_spouse_survives",
      "if_spouse_predeceased",
      "always",
    ]),
    sortOrder: z.number().int().min(0),
    recipients: z.array(willBequestRecipientSchema).min(1),
  })
  .superRefine((b, ctx) => {
    if (b.assetMode === "specific" && b.accountId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "accountId is required when assetMode='specific'",
      });
    }
    if (b.assetMode === "all_assets" && b.accountId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "accountId must be null when assetMode='all_assets'",
      });
    }
    const sum = b.recipients.reduce((s, r) => s + r.percentage, 0);
    if (Math.abs(sum - 100) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `recipient percentages must sum to 100 (got ${sum})`,
      });
    }
  });

export const willCreateSchema = z.object({
  grantor: z.enum(["client", "spouse"]),
  bequests: z.array(willBequestSchema).default([]),
});

export const willUpdateSchema = z.object({
  bequests: z.array(willBequestSchema).default([]),
});

export type WillBequestRecipientInput = z.infer<typeof willBequestRecipientSchema>;
export type WillBequestInput = z.infer<typeof willBequestSchema>;
export type WillCreateInput = z.infer<typeof willCreateSchema>;
export type WillUpdateInput = z.infer<typeof willUpdateSchema>;
