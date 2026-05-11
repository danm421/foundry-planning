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
] as const;
export type ComparisonWidgetKind = (typeof WIDGET_KINDS)[number];

export const ComparisonWidgetKindSchema = z.enum(WIDGET_KINDS);

export const ComparisonLayoutItemSchema = z.object({
  instanceId: z.string().uuid(),
  kind: ComparisonWidgetKindSchema,
  hidden: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  config: z.unknown().optional(),
});
export type ComparisonLayoutItem = z.infer<typeof ComparisonLayoutItemSchema>;

export const ComparisonLayoutSchema = z.object({
  version: z.literal(1),
  items: z.array(ComparisonLayoutItemSchema),
});
export type ComparisonLayout = z.infer<typeof ComparisonLayoutSchema>;
