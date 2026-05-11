import type { ComparisonWidgetKind } from "../layout-schema";
import type { ComparisonWidgetDefinition } from "./types";
import { kpiStripWidget } from "./kpi-strip";
import { portfolioWidget } from "./portfolio";
import { monteCarloWidget } from "./monte-carlo";
import { longevityWidget } from "./longevity";
import { lifetimeTaxWidget } from "./lifetime-tax";
import { liquidityWidget } from "./liquidity";
import { estateImpactWidget } from "./estate-impact";
import { estateTaxWidget } from "./estate-tax";
import { textWidget } from "./text";

export const COMPARISON_WIDGETS: Record<
  ComparisonWidgetKind,
  ComparisonWidgetDefinition
> = {
  "kpi-strip": kpiStripWidget,
  portfolio: portfolioWidget,
  "monte-carlo": monteCarloWidget,
  longevity: longevityWidget,
  "lifetime-tax": lifetimeTaxWidget,
  liquidity: liquidityWidget,
  "estate-impact": estateImpactWidget,
  "estate-tax": estateTaxWidget,
  text: textWidget,
};
