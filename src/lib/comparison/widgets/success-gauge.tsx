import { SuccessGauge } from "@/components/monte-carlo/success-gauge";
import type { ComparisonWidgetDefinition } from "./types";

export const successGaugeWidget: ComparisonWidgetDefinition = {
  kind: "success-gauge",
  title: "Success Probability",
  category: "monte-carlo",
  scenarios: "one",
  defaultPlanCount: 1,
  needsMc: true,
  render: ({ plans, mc }) => {
    const plan = plans[0];
    if (!mc) {
      return (
        <section className="px-6 py-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">
            Success Probability
          </h2>
          <div className="h-32 animate-pulse rounded border border-slate-800 bg-slate-900" />
        </section>
      );
    }
    const idx = plan
      ? mc.perPlan.findIndex((p) => p.label === plan.label)
      : -1;
    const probability = mc.successByIndex[idx >= 0 ? idx : 0] ?? 0;
    return (
      <section className="px-6 py-8">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">
          Success Probability
        </h2>
        <div className="flex flex-col items-center gap-2">
          <SuccessGauge value={probability} />
          <div className="text-xs uppercase tracking-wide text-slate-400">
            {plan?.label}
          </div>
          <div className="text-[10px] text-slate-500">
            Threshold {Math.round(mc.threshold * 100)}%
          </div>
        </div>
      </section>
    );
  },
};
