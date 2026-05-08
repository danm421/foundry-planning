import { z } from "zod";

export const flowOverrideRowSchema = z.object({
  year: z.number().int(),
  incomeAmount: z.number().nullable().optional(),
  expenseAmount: z.number().nullable().optional(),
  distributionPercent: z.number().min(0).max(1).nullable().optional(),
});

export const flowOverrideBulkSchema = z
  .object({
    overrides: z.array(flowOverrideRowSchema),
  })
  .refine(
    (data) => {
      const years = data.overrides.map((o) => o.year);
      return new Set(years).size === years.length;
    },
    { message: "Duplicate year values are not allowed", path: ["overrides"] },
  );

export type FlowOverrideRow = z.infer<typeof flowOverrideRowSchema>;
export type FlowOverrideBulk = z.infer<typeof flowOverrideBulkSchema>;
