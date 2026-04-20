import { z } from "zod";
import {
  TRUST_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "@/lib/entities/trust";

const entityTypeSchema = z.enum([
  "trust",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "foundation",
  "other",
]);

const trustSubTypeSchema = z.enum([...TRUST_SUB_TYPES] as [string, ...string[]]);

const namePctRowSchema = z.object({
  name: z.string(),
  pct: z.number(),
});

const baseEntityFields = {
  name: z.string().trim().min(1, "Name is required"),
  entityType: entityTypeSchema,
  notes: z.string().trim().nullish(),
  includeInPortfolio: z.boolean().optional(),
  isGrantor: z.boolean().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  owner: z.enum(["client", "spouse", "joint"]).nullish(),
  grantors: z.array(namePctRowSchema).nullish(),
  beneficiaries: z.array(namePctRowSchema).nullish(),
  trustSubType: trustSubTypeSchema.optional(),
  isIrrevocable: z.boolean().optional(),
  trustee: z.string().trim().nullish(),
  exemptionConsumed: z.number().nonnegative().optional(),
};

export const entityCreateSchema = z
  .object(baseEntityFields)
  .superRefine((data, ctx) => {
    const isTrust = data.entityType === "trust";

    if (!isTrust) {
      if (data.trustSubType !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trustSubType"],
          message: "trustSubType is only allowed when entityType = 'trust'",
        });
      }
      if (data.isIrrevocable !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["isIrrevocable"],
          message: "isIrrevocable is only allowed when entityType = 'trust'",
        });
      }
      if (data.trustee !== undefined && data.trustee !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trustee"],
          message: "trustee is only allowed when entityType = 'trust'",
        });
      }
      if (
        data.exemptionConsumed !== undefined &&
        data.exemptionConsumed !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["exemptionConsumed"],
          message:
            "exemptionConsumed must be 0 when entityType != 'trust'",
        });
      }
      return;
    }

    if (data.trustSubType === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trustSubType"],
        message: "trustSubType is required for trusts",
      });
    }
    if (data.isIrrevocable === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isIrrevocable"],
        message: "isIrrevocable is required for trusts",
      });
    }
    if (
      data.trustSubType !== undefined &&
      data.isIrrevocable !== undefined &&
      deriveIsIrrevocable(data.trustSubType as TrustSubType) !==
        data.isIrrevocable
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isIrrevocable"],
        message:
          "isIrrevocable must match trustSubType (revocable → false; all others → true)",
      });
    }
  });

export const entityUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(baseEntityFields).map(([k, v]) => [
        k,
        (v as z.ZodTypeAny).optional(),
      ]),
    ) as Record<string, z.ZodTypeAny>,
  )
  .superRefine((data, ctx) => {
    const d = data as {
      trustSubType?: string;
      isIrrevocable?: boolean;
    };
    if (
      d.trustSubType !== undefined &&
      d.isIrrevocable !== undefined &&
      deriveIsIrrevocable(d.trustSubType as TrustSubType) !== d.isIrrevocable
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isIrrevocable"],
        message:
          "isIrrevocable must match trustSubType (revocable → false; all others → true)",
      });
    }
  });

export type EntityCreateInput = z.infer<typeof entityCreateSchema>;
export type EntityUpdateInput = z.infer<typeof entityUpdateSchema>;
