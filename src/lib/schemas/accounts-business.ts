import { z } from "zod";

/**
 * Validates a request body for creating a `business` account.
 *
 * Owner-row shape uses the simple `{ familyMemberId | entityId }` form
 * (exactly one populated) — matches the form's serialized shape and is
 * adapted to the canonical `{ kind, ... }` shape at the API boundary by
 * `validateOwnersShape`. We don't surface `external_beneficiary_id` here
 * (deferred — Phase 2 has no UI for it).
 *
 * Numeric fields use `z.coerce.number()` so JSON bodies that send strings
 * (e.g. from a form input) are accepted alongside true numbers.
 */
export const BusinessOwnerRowSchema = z
  .object({
    familyMemberId: z.string().uuid().nullable(),
    entityId: z.string().uuid().nullable(),
    percent: z.coerce.number().min(0).max(1),
  })
  .refine(
    (row) =>
      (row.familyMemberId !== null && row.entityId === null) ||
      (row.familyMemberId === null && row.entityId !== null),
    {
      message: "Each owner row must set exactly one of familyMemberId or entityId",
    },
  );

export const AddBusinessInputSchema = z.object({
  name: z.string().min(1),
  businessType: z.enum([
    "sole_prop",
    "partnership",
    "s_corp",
    "c_corp",
    "llc",
    "other",
  ]),
  value: z.coerce.number().min(0),
  basis: z.coerce.number().min(0),
  growthRate: z.coerce.number().nullable().optional(),
  distributionPolicyPercent: z.coerce
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional(),
  flowMode: z.enum(["annual", "schedule"]).default("annual"),
  businessTaxTreatment: z
    .enum(["qbi", "ordinary", "non_taxable"])
    .default("qbi"),
  parentAccountId: z.string().uuid().nullable().optional(),
  owners: z
    .array(BusinessOwnerRowSchema)
    .min(1)
    .refine(
      (rows) => Math.abs(rows.reduce((s, r) => s + r.percent, 0) - 1) < 0.0001,
      { message: "Ownership percentages must sum to 100%" },
    ),
});

export type AddBusinessInput = z.infer<typeof AddBusinessInputSchema>;
export type BusinessOwnerRow = z.infer<typeof BusinessOwnerRowSchema>;
