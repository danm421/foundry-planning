import { z } from "zod";

export const WIDGET_KINDS = [
  "kpi-strip",
  "portfolio",
  "monte-carlo",
  "longevity",
  "lifetime-tax",
  "liquidity",
  "estate-impact",
  "estate-tax",
  "text",
  "income-expense",
  "withdrawal-source",
  "year-by-year",
  "ss-income",
  "allocation-drift",
  "tax-bracket-fill",
  "roth-ladder",
  "rmd-schedule",
  "charitable-impact",
  "decade-summary",
  "cash-flow-gap",
] as const;
export type ComparisonWidgetKind = (typeof WIDGET_KINDS)[number];

export const ComparisonWidgetKindSchema = z.enum(WIDGET_KINDS);

export const ComparisonLayoutItemSchema = z.object({
  instanceId: z.string().uuid(),
  kind: ComparisonWidgetKindSchema,
  config: z.unknown().optional(),
});
export type ComparisonLayoutItem = z.infer<typeof ComparisonLayoutItemSchema>;

export const YearRangeSchema = z
  .object({
    start: z.number().int(),
    end: z.number().int(),
  })
  .refine((r) => r.start <= r.end, {
    message: "yearRange.start must be ≤ yearRange.end",
  });
export type YearRange = z.infer<typeof YearRangeSchema>;

export const ComparisonLayoutSchema = z.object({
  version: z.literal(3),
  yearRange: YearRangeSchema.nullable(),
  items: z.array(ComparisonLayoutItemSchema),
});
export type ComparisonLayout = z.infer<typeof ComparisonLayoutSchema>;
