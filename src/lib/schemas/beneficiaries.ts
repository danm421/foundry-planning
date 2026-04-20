import { z } from "zod";
import {
  validateBeneficiarySplit,
  type DesignationInput,
} from "@/lib/beneficiaries/validate-split";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const externalBeneficiaryKindSchema = z.enum(["charity", "individual"]);

export const externalBeneficiaryCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: externalBeneficiaryKindSchema.optional().default("charity"),
  notes: z.string().trim().nullish(),
});

export const externalBeneficiaryUpdateSchema =
  externalBeneficiaryCreateSchema.partial();

export const beneficiaryDesignationSchema = z
  .object({
    tier: z.enum(["primary", "contingent"]),
    percentage: z.number().gt(0).lte(100),
    familyMemberId: z.string().regex(uuidRegex, "Invalid UUID format").optional(),
    externalBeneficiaryId: z.string().regex(uuidRegex, "Invalid UUID format").optional(),
    sortOrder: z.number().int().nonnegative().optional().default(0),
  })
  .refine(
    (d) =>
      (!!d.familyMemberId && !d.externalBeneficiaryId) ||
      (!d.familyMemberId && !!d.externalBeneficiaryId),
    { message: "Exactly one of familyMemberId or externalBeneficiaryId must be set." },
  );

export const beneficiarySetSchema = z
  .array(beneficiaryDesignationSchema)
  .superRefine((list, ctx) => {
    const inputs: DesignationInput[] = list.map((d) => ({
      tier: d.tier,
      percentage: d.percentage,
      familyMemberId: d.familyMemberId,
      externalBeneficiaryId: d.externalBeneficiaryId,
    }));
    const r = validateBeneficiarySplit(inputs);
    if (!r.ok) {
      for (const msg of r.errors) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
      }
    }
  });

export type ExternalBeneficiaryCreate = z.infer<
  typeof externalBeneficiaryCreateSchema
>;
export type BeneficiaryDesignationInput = z.infer<
  typeof beneficiaryDesignationSchema
>;
