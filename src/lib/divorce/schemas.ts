// Zod schemas for the divorce-planning API surface (draft settings PATCH +
// allocations PUT). Pure validation vocabulary — no DB/Next imports — shared
// by the route handlers (Task 6) and the draft service (divorce-plans.ts).
import { z } from "zod";
import { usStateSchema } from "@/lib/crm/schemas";
import { DIVORCE_TARGET_KINDS } from "./allocation-rules";

// Persisted commit-preview cleanup checklist: which beneficiary designations /
// will bequests / will residuary recipients naming the soon-to-be-ex-spouse
// should be removed on commit. `source` mirrors the three places a spouse can
// be named; `id` is the row id in that source table.
export const beneficiaryCleanupSchema = z.object({
  selections: z
    .array(
      z.object({
        source: z.enum([
          "beneficiary_designation",
          "will_bequest_recipient",
          "will_residuary_recipient",
        ]),
        id: z.uuid(),
        remove: z.boolean(),
      }),
    )
    .max(200),
});

// PATCH body for the draft's settings. Every field optional (partial patch);
// `.strict()` rejects unknown keys so a typo doesn't silently no-op.
export const divorceDraftSettingsSchema = z
  .object({
    // The spouse's post-split file can never be "married" — that's the whole
    // point of the split — so this is a narrower enum than the DB's
    // filing_status (which also carries married_joint/married_separate).
    primaryFilingStatus: z.enum(["single", "head_of_household"]).optional(),
    spouseFilingStatus: z.enum(["single", "head_of_household"]).optional(),
    // Nullable (clear the override, fall back to the household state) AND
    // optional (omit ⇒ leave unchanged) — two different "no value" meanings.
    spouseState: usStateSchema.nullable().optional(),
    splitYear: z.number().int().min(2020).max(2100).optional(),
    beneficiaryCleanup: beneficiaryCleanupSchema.optional(),
  })
  .strict();

export type DivorceDraftSettings = z.infer<typeof divorceDraftSettingsSchema>;

// PUT body for the allocations batch. `splitPercentToSpouse` defaults to null
// so a plain primary/spouse/duplicate item can omit it entirely.
export const divorceAllocationsPutSchema = z.object({
  items: z
    .array(
      z.object({
        targetKind: z.enum(DIVORCE_TARGET_KINDS),
        targetId: z.uuid(),
        disposition: z.enum(["primary", "spouse", "split", "duplicate"]),
        splitPercentToSpouse: z.number().gt(0).lt(100).nullable().default(null),
      }),
    )
    .min(1)
    .max(500),
});

export type DivorceAllocationItem = z.infer<typeof divorceAllocationsPutSchema>["items"][number];
