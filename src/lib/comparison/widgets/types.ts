import type { ReactNode } from "react";
import type { z } from "zod";
import type { ComparisonWidgetKindV4, YearRange } from "../layout-schema";
import type { ComparisonPlan } from "../build-comparison-plans";
import type { PlanMcData } from "@/components/comparison/monte-carlo-comparison-section";
import type { ProjectionYear } from "@/engine";

/** Re-exported under the legacy name so callers don't need to change imports. */
export type ComparisonWidgetKind = ComparisonWidgetKindV4;

/** Shared MC fetch + run result, populated by useSharedMcRun.
 *  `null` while loading or when nothing demands MC. */
export interface McSharedResult {
  perPlan: PlanMcData[];
  threshold: number;
  successByIndex: Record<number, number>;
  planStartYear: number;
  clientBirthYear: number | undefined;
}

/** Lightweight view of useSharedMcRun for widget renders. Widgets that
 *  `needsMc` use this to render explicit loading/error states instead of
 *  the legacy "null mc" empty skeleton. */
export interface McRunView {
  status: "idle" | "loading" | "ready" | "error";
  phase?: "fetching" | "running";
  done?: number;
  total?: number;
  error?: string;
  retry: () => void;
}

/** No-op mcRun for contexts that don't drive a real MC fetch (layout-mode
 *  thumbnails, isolated tests). Widgets that need MC will render their
 *  idle placeholder; nothing will attempt to retry. */
export const IDLE_MC_RUN: McRunView = {
  status: "idle",
  retry: () => {},
};

export interface ComparisonWidgetContext {
  instanceId: string;
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  /** Status + retry for the shared MC run. Always present even for widgets
   *  that don't need MC — they just ignore it. */
  mcRun: McRunView;
  config?: unknown;
  /** Page-level year-range clip. `null` = show all years. Widgets that show
   *  per-year data should filter years by start/end inclusive. */
  yearRange: YearRange | null;
  /** True when the Widget panel is open. Widgets may render an editor variant. */
  editing: boolean;
  /** Updates a text widget's markdown in the parent layout state.
   *  Only meaningful for the `text` widget. */
  onTextChange?: (instanceId: string, markdown: string) => void;
  /** Cell id this widget instance occupies in the v5 layout. Distinct
   *  from `instanceId` (which is `widget.id`). The text widget uses this
   *  to open its expand modal for the right cell. */
  cellId?: string;
  /** Open the full text-widget expand modal for this cell. The `mode`
   *  mirrors the layout's edit/view state. */
  onExpand?: (cellId: string, mode: "edit" | "view") => void;
}

export type ComparisonWidgetCategory =
  | "kpis"
  | "cashflow"
  | "investments"
  | "monte-carlo"
  | "retirement-income"
  | "tax"
  | "estate"
  | "text"
  | "scenario";

export type ComparisonWidgetScenarios =
  | "none"
  | "one"
  | "one-or-many"
  | "many-only";

export interface ComparisonWidgetConfigContext<TConfig = unknown> {
  config: TConfig | undefined;
  onChange: (next: TConfig) => void;
}

export interface ComparisonWidgetDefinition<TConfig = unknown> {
  kind: ComparisonWidgetKind;
  title: string;
  category: ComparisonWidgetCategory;
  scenarios: ComparisonWidgetScenarios;
  /** Default number of plans bound when widget is added from the panel.
   *  Defaults to scenarios-implied minimum (none→0, one→1, many-only→2, one-or-many→1). */
  defaultPlanCount?: number;
  needsMc: boolean;
  configSchema?: z.ZodType<TConfig>;
  defaultConfig?: TConfig;
  render: (ctx: ComparisonWidgetContext) => ReactNode;
  /** Optional inline panel config UI. Receives the current config and a setter. */
  renderConfig?: (ctx: ComparisonWidgetConfigContext<TConfig>) => ReactNode;
  /** Optional predicate used by the year-range "Data" preset to crop to years
   *  where this widget actually shows something. Return true if the given year
   *  for the given plan contains data the widget would render. When omitted,
   *  every year counts as data (preset is disabled by the modal). */
  hasDataInYear?: (plan: ComparisonPlan, year: ProjectionYear) => boolean;
  /** Optional seed for `WidgetInstance.yearRange` at widget creation time.
   *  Receives the bound plans (already seeded by scenarios). Return undefined
   *  to leave yearRange unset (which means "use page-level range / all years"). */
  defaultYearRange?: (ctx: { plans: ComparisonPlan[] }) => YearRange | undefined;
}
