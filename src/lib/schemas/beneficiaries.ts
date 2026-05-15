import { z } from "zod";
import {
  validateBeneficiarySplit,
  type DesignationInput,
} from "@/lib/beneficiaries/validate-split";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const externalBeneficiaryKindSchema = z.enum(["charity", "individual"]);

export const externalBeneficiaryCharityTypeSchema = z.enum(["public", "private"]);

export const externalBeneficiaryCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: externalBeneficiaryKindSchema.optional().default("charity"),
  charityType: externalBeneficiaryCharityTypeSchema.optional().default("public"),
  notes: z.string().trim().nullish(),
});

export const externalBeneficiaryUpdateSchema =
  externalBeneficiaryCreateSchema.partial();

export const beneficiaryDesignationSchema = z
  .object({
    tier: z.enum(["primary", "contingent", "income", "remainder"]),
    percentage: z.number().gt(0).lte(100),
    familyMemberId: z.string().regex(uuidRegex, "Invalid UUID format").nullable().optional(),
    externalBeneficiaryId: z.string().regex(uuidRegex, "Invalid UUID format").nullable().optional(),
    entityIdRef: z.string().uuid().nullable().optional(),
    householdRole: z.enum(["client", "spouse"]).nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional().default(0),
    distributionForm: z.enum(["in_trust", "outright"]).optional(),
  })
  .refine(
    (d) => {
      const sources = [d.familyMemberId, d.externalBeneficiaryId, d.entityIdRef, d.householdRole];
      const nonNull = sources.filter((s) => s != null && s !== "");
      return nonNull.length === 1;
    },
    {
      message:
        "Exactly one of familyMemberId, externalBeneficiaryId, entityIdRef, or householdRole must be set.",
    },
  )
  .transform((d) => ({
    ...d,
    distributionForm:
      d.tier === "remainder" ? (d.distributionForm ?? "outright") : undefined,
  }));

export const beneficiarySetSchema = z
  .array(beneficiaryDesignationSchema)
  .superRefine((list, ctx) => {
    const inputs: DesignationInput[] = list.map((d) => ({
      tier: d.tier,
      percentage: d.percentage,
      familyMemberId: d.familyMemberId ?? undefined,
      externalBeneficiaryId: d.externalBeneficiaryId ?? undefined,
      entityIdRef: d.entityIdRef,
      householdRole: d.householdRole,
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
