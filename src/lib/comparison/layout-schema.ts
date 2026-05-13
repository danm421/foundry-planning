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

// ---------- v4 ----------

export const WIDGET_KINDS_V4 = [
  "kpi",        // NEW v4 — single-metric tile
  "kpi-strip",  // LEGACY — kept for migration; no new v4 layouts should reference it
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
  "estate-transfers-yearly",
  "estate-end-beneficiaries",
  "gift-tax",
  "success-gauge",
  "asset-allocation",
  "major-transactions",
  "scenario-changes",
  "client-profile",
  "income-sources",
  "balance-sheet",
  "expense-detail",
] as const;
export type ComparisonWidgetKindV4 = (typeof WIDGET_KINDS_V4)[number];

export const ComparisonWidgetKindV4Schema = z.enum(WIDGET_KINDS_V4);

export const WidgetInstanceSchema = z.object({
  id: z.string(),
  kind: ComparisonWidgetKindV4Schema,
  planIds: z.array(z.string()),
  yearRange: YearRangeSchema.optional(),
  config: z.unknown().optional(),
});
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>;

export const CellSchema = z.object({
  id: z.string(),
  widget: WidgetInstanceSchema,
});
export type Cell = z.infer<typeof CellSchema>;

export const RowSchema = z.object({
  id: z.string(),
  cells: z.array(CellSchema).min(1).max(5),
});
export type Row = z.infer<typeof RowSchema>;

export const ComparisonLayoutV4Schema = z.object({
  version: z.literal(4),
  title: z.string(),
  rows: z.array(RowSchema),
});
export type ComparisonLayoutV4 = z.infer<typeof ComparisonLayoutV4Schema>;

// ---------- v5 ----------

export const CellSpanSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type CellSpan = z.infer<typeof CellSpanSchema>;

export const CellV5Schema = z.object({
  id: z.string(),
  span: CellSpanSchema,
  widget: WidgetInstanceSchema.nullable(),
});
export type CellV5 = z.infer<typeof CellV5Schema>;

export const GroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  cells: z.array(CellV5Schema),
});
export type Group = z.infer<typeof GroupSchema>;

export const ComparisonLayoutV5Schema = z.object({
  version: z.literal(5),
  title: z.string(),
  groups: z.array(GroupSchema),
});
export type ComparisonLayoutV5 = z.infer<typeof ComparisonLayoutV5Schema>;

// ---------- text widget config ----------

export const AiToneSchema = z.enum(["concise", "detailed", "plain"]);
export type AiTone = z.infer<typeof AiToneSchema>;

export const AiLengthSchema = z.enum(["short", "medium", "long"]);
export type AiLength = z.infer<typeof AiLengthSchema>;

export const TextWidgetAiConfigSchema = z.object({
  sources: z.object({
    groupIds: z.array(z.string()).default([]),
    cellIds: z.array(z.string()).default([]),
  }),
  tone: AiToneSchema.default("concise"),
  length: AiLengthSchema.default("medium"),
  customInstructions: z.string().default(""),
  lastGenerated: z
    .object({
      hash: z.string(),
      at: z.string(),
      cached: z.boolean(),
    })
    .optional(),
});
export type TextWidgetAiConfig = z.infer<typeof TextWidgetAiConfigSchema>;

export const TextWidgetConfigSchema = z.object({
  markdown: z.string().default(""),
  ai: TextWidgetAiConfigSchema.optional(),
});
export type TextWidgetConfig = z.infer<typeof TextWidgetConfigSchema>;
