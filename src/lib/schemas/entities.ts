import { z } from "zod";
import {
  TRUST_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "@/lib/entities/trust";
import { trustSplitInterestSchema } from "./trust-split-interest";

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

/**
 * Validates mode-amount coherence rules for distribution policy fields. Does
 * NOT check the irrevocability gate — that differs between create and update
 * paths and is handled inline at each call site.
 *
 * NOTE: The "at least one income beneficiary required when mode is set"
 * invariant is intentionally NOT enforced here. Income-beneficiary designations
 * are saved in a separate request (via the designations endpoint), so the
 * entity payload never contains them. That invariant is enforced on the
 * form side instead.
 */
function validateDistributionInvariants(
  data: {
    distributionMode?: "fixed" | "pct_liquid" | "pct_income" | null | undefined;
    distributionAmount?: number | null | undefined;
    distributionPercent?: number | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (!data.distributionMode) return;

  // Mode-amount coherence
  if (data.distributionMode === "fixed") {
    if (data.distributionAmount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionAmount"],
        message: "distributionAmount is required when distributionMode = 'fixed'",
      });
    }
    if (data.distributionPercent != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionPercent"],
        message: "distributionPercent must be null when distributionMode = 'fixed'",
      });
    }
  }
  if (
    data.distributionMode === "pct_liquid" ||
    data.distributionMode === "pct_income"
  ) {
    if (data.distributionPercent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionPercent"],
        message: `distributionPercent is required when distributionMode = '${data.distributionMode}'`,
      });
    }
    if (data.distributionAmount != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionAmount"],
        message: `distributionAmount must be null when distributionMode = '${data.distributionMode}'`,
      });
    }
  }
}

const entityOwnerInputSchema = z.object({
  familyMemberId: z.string().uuid(),
  percent: z.number().min(0).max(1),
});

const baseEntityFields = {
  grantor: z.enum(["client", "spouse"]).nullish(),
  name: z.string().trim().min(1, "Name is required"),
  entityType: entityTypeSchema,
  notes: z.string().trim().nullish(),
  includeInPortfolio: z.boolean().optional(),
  accessibleToClient: z.boolean().optional(),
  isGrantor: z.boolean().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  basis: z.union([z.string(), z.number()]).optional(),
  owner: z.enum(["client", "spouse", "joint"]).nullish(),
  /** Multi-owner allocation for business entities. Sum of percents must equal 1.0. */
  owners: z.array(entityOwnerInputSchema).optional(),
  beneficiaries: z.array(namePctRowSchema).nullish(),
  trustSubType: trustSubTypeSchema.optional(),
  isIrrevocable: z.boolean().optional(),
  trustee: z.string().trim().nullish(),
  trustEnds: z.enum(["client_death", "spouse_death", "survivorship"]).nullable().optional(),
  distributionMode: z.enum(["fixed", "pct_liquid", "pct_income"]).nullish(),
  distributionAmount: z.number().nonnegative().nullish(),
  distributionPercent: z.number().min(0).max(1).nullish(),
  taxTreatment: z.enum(["qbi", "ordinary", "non_taxable"]).optional(),
  distributionPolicyPercent: z.number().min(0).max(1).optional().nullable(),
  splitInterest: trustSplitInterestSchema.optional(),
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
      if (data.distributionMode !== undefined && data.distributionMode !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["distributionMode"],
          message: "distributionMode is only allowed when entityType = 'trust'",
        });
      }
      if (data.distributionAmount !== undefined && data.distributionAmount !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["distributionAmount"],
          message: "distributionAmount is only allowed when entityType = 'trust'",
        });
      }
      if (data.distributionPercent !== undefined && data.distributionPercent !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["distributionPercent"],
          message: "distributionPercent is only allowed when entityType = 'trust'",
        });
      }
      if (data.splitInterest !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["splitInterest"],
          message: "splitInterest is only allowed when entityType = 'trust'",
        });
      }
      return;
    }

    if (data.trustSubType === "clut" && !data.splitInterest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["splitInterest"],
        message: "splitInterest payload is required when trustSubType = 'clut'",
      });
    }
    if (data.trustSubType !== "clut" && data.splitInterest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["splitInterest"],
        message: "splitInterest is only allowed when trustSubType = 'clut'",
      });
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

    // Irrevocability gate: create path fires when distributionMode is present but
    // trust is not irrevocable (undefined or false).
    if (!data.isIrrevocable && data.distributionMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionMode"],
        message: "distributionMode is only allowed on irrevocable trusts",
      });
    }

    validateDistributionInvariants(data, ctx);
  });

export const entityUpdateSchema = z
  .object({
    ...(Object.fromEntries(
      Object.entries(baseEntityFields).map(([k, v]) => [
        k,
        (v as z.ZodTypeAny).optional(),
      ]),
    ) as Record<string, z.ZodTypeAny>),
    // Update path uses partial semantics — both Phase 1 flow fields are nullable.
    taxTreatment: z.enum(["qbi", "ordinary", "non_taxable"]).optional().nullable(),
    distributionPolicyPercent: z.number().min(0).max(1).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const d = data as {
      trustSubType?: string;
      isIrrevocable?: boolean;
      distributionMode?: "fixed" | "pct_liquid" | "pct_income" | null;
      distributionAmount?: number | null;
      distributionPercent?: number | null;
      splitInterest?: unknown;
    };

    if (
      d.splitInterest !== undefined &&
      d.trustSubType !== undefined &&
      d.trustSubType !== "clut"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["splitInterest"],
        message: "splitInterest is only allowed when trustSubType = 'clut'",
      });
    }

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

    // Distribution validations: only when distributionMode is present in the patch.
    if (d.distributionMode) {
      // Irrevocability gate: update path fires only when this patch is explicitly
      // flipping isIrrevocable to false (strict equality — not undefined).
      if (d.isIrrevocable === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["distributionMode"],
          message: "distributionMode is only allowed on irrevocable trusts",
        });
      }

      validateDistributionInvariants(d, ctx);
    }
  });

export type EntityCreateInput = z.infer<typeof entityCreateSchema>;
export type EntityUpdateInput = z.infer<typeof entityUpdateSchema>;
