import type { ReactNode } from "react";
import type { z } from "zod";
import type { ComparisonWidgetKind } from "../layout-schema";
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
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  collapsed: boolean;
  config?: unknown;
}

export interface ComparisonWidgetDefinition<TConfig = unknown> {
  kind: ComparisonWidgetKind;
  title: string;
  needsMc: boolean;
  configSchema?: z.ZodType<TConfig>;
  defaultConfig?: TConfig;
  render: (ctx: ComparisonWidgetContext) => ReactNode;
}
