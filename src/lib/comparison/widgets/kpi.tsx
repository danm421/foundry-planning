import { z } from "zod";
import {
  KpiComparisonSection,
  type KpiMetric,
} from "@/components/comparison/kpi-comparison-section";
import type { ComparisonPlan } from "../build-comparison-plans";
import type { ComparisonWidgetDefinition } from "./types";

const KpiMetricSchema = z.enum([
  "successProbability",
  "longevityAge",
  "endNetWorth",
  "lifetimeTax",
  "netToHeirs",
]);

const KpiConfigSchema = z.object({
  metric: KpiMetricSchema,
});

export type KpiConfig = z.infer<typeof KpiConfigSchema>;

function metricValue(
  metric: KpiMetric,
  plan: ComparisonPlan | undefined,
  successProbability: number | undefined,
): number | undefined {
  if (!plan && metric !== "successProbability") return undefined;
  switch (metric) {
    case "successProbability":
      return successProbability;
    case "longevityAge":
      return plan?.result.years.at(-1)?.ages.client;
    case "endNetWorth":
      return plan?.result.years.at(-1)?.portfolioAssets?.total;
    case "lifetimeTax":
      return plan?.lifetime.total;
    case "netToHeirs":
      return plan?.finalEstate?.totalToHeirs ?? 0;
  }
}

export const kpiWidget: ComparisonWidgetDefinition<KpiConfig> = {
  kind: "kpi",
  title: "KPI",
  category: "kpis",
  scenarios: "one",
  defaultPlanCount: 1,
  needsMc: true,
  configSchema: KpiConfigSchema,
  defaultConfig: { metric: "endNetWorth" },
  render: ({ plans, config, mc }) => {
    const parsed = KpiConfigSchema.safeParse(config);
    const metric: KpiMetric = parsed.success ? parsed.data.metric : "endNetWorth";
    const plan = plans[0];
    const successProbability = mc?.successByIndex[0];
    const value = metricValue(metric, plan, successProbability);
    return <KpiComparisonSection metric={metric} value={value} />;
  },
};
