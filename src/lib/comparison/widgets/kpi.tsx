import { z } from "zod";
import {
  KpiComparisonSection,
  type KpiMetric,
} from "@/components/comparison/kpi-comparison-section";
import type { ComparisonWidgetDefinition } from "./types";
import { kpiMetricValue } from "./kpi-metric";

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
    const metric: KpiMetric = parsed.success ? parsed.data.metric : "endNetWorth";
    const plan = plans[0];
    const raw = kpiMetricValue(metric, plan, mc ?? null, 0);
    const value = raw ?? undefined;
    return <KpiComparisonSection metric={metric} value={value} />;
  },
  renderConfig: ({ config, onChange }) => {
    const current = KpiConfigSchema.safeParse(config).success
      ? (config as KpiConfig).metric
      : "endNetWorth";
    return (
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <span>Metric</span>
        <select
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          value={current}
          onChange={(e) => onChange({ metric: e.target.value as KpiMetric })}
        >
          <option value="successProbability">Success Probability</option>
          <option value="longevityAge">Longevity Age</option>
          <option value="endNetWorth">End Net Worth</option>
          <option value="lifetimeTax">Lifetime Tax</option>
          <option value="netToHeirs">Net to Heirs</option>
        </select>
      </label>
    );
  },
};
