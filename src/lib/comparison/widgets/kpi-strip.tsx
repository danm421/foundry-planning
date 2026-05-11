import { ComparisonKpiStrip } from "@/app/(app)/clients/[id]/comparison/comparison-kpi-strip";
import type { ComparisonWidgetDefinition } from "./types";

export const kpiStripWidget: ComparisonWidgetDefinition = {
  kind: "kpi-strip",
  title: "Key metrics",
  category: "kpis",
  scenarios: "one-or-many",
  needsMc: true,
  render: ({ plans, mc }) => {
    return (
      <ComparisonKpiStrip plans={plans} mcSuccessByIndex={mc?.successByIndex ?? {}} />
    );
  },
};
