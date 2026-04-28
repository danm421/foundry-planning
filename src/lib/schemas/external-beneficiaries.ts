import { z } from "zod";

const base = {
  name: z.string().min(1).max(200),
  kind: z.enum(["charity", "individual"]).default("charity"),
  charityType: z.enum(["public", "private"]).default("public"),
  notes: z.string().trim().nullish(),
};

export const externalBeneficiaryCreateSchema = z.object(base);

export const externalBeneficiaryUpdateSchema = z.object(
  Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
  ) as Record<string, z.ZodTypeAny>,
);

export type ExternalBeneficiaryCreateInput = z.infer<typeof externalBeneficiaryCreateSchema>;
export type ExternalBeneficiaryUpdateInput = z.infer<typeof externalBeneficiaryUpdateSchema>;
