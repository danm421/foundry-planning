import type { ReactNode } from "react";
import type { z } from "zod";
import type { ComparisonWidgetKind, YearRange } from "../layout-schema";
import type { ComparisonPlan } from "../build-comparison-plans";
import type { PlanMcData } from "@/components/comparison/monte-carlo-comparison-section";

export type { ComparisonWidgetKind };

/** Shared MC fetch + run result, populated by useSharedMcRun.
 *  `null` while loading or when nothing demands MC. */
export interface McSharedResult {
  perPlan: PlanMcData[];
  threshold: number;
  successByIndex: Record<number, number>;
  planStartYear: number;
  clientBirthYear: number | undefined;
}

export interface ComparisonWidgetContext {
  instanceId: string;
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  config?: unknown;
  /** Page-level year-range clip. `null` = show all years. Widgets that show
   *  per-year data should filter years by start/end inclusive. */
  yearRange: YearRange | null;
  /** True when the Widget panel is open. Widgets may render an editor variant. */
  editing: boolean;
  /** Updates a text widget's markdown in the parent layout state.
   *  Only meaningful for the `text` widget. */
  onTextChange?: (instanceId: string, markdown: string) => void;
}

export interface ComparisonWidgetDefinition<TConfig = unknown> {
  kind: ComparisonWidgetKind;
  title: string;
  needsMc: boolean;
  configSchema?: z.ZodType<TConfig>;
  defaultConfig?: TConfig;
  render: (ctx: ComparisonWidgetContext) => ReactNode;
}
