import { z } from "zod";
import { KpiComparisonSection } from "@/components/comparison/kpi-comparison-section";
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
    const metric = parsed.success ? parsed.data.metric : "endNetWorth";
    const plan = plans[0];
    const successProbability = mc?.successByIndex[0];
    return (
      <KpiComparisonSection
        plan={plan}
        metric={metric}
        successProbability={successProbability}
      />
    );
  },
};
