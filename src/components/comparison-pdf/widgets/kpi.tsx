// src/components/comparison-pdf/widgets/kpi.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import {
  kpiMetricValue,
  formatKpi,
  KPI_METRIC_LABELS,
} from "@/lib/comparison/widgets/kpi-metric";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";

const s = StyleSheet.create({
  wrap: { padding: 6 },
  tile: {
    borderWidth: 0.5,
    borderColor: PDF_THEME.hair,
    padding: 10,
  },
  label: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: PDF_THEME.ink3,
    marginBottom: 4,
  },
  value: {
    fontFamily: "Fraunces",
    fontSize: 22,
    fontWeight: 700,
  },
  plan: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PDF_THEME.ink2,
    marginTop: 2,
    marginBottom: 6,
  },
});

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%",
  2: "40%",
  3: "60%",
  4: "80%",
  5: "100%",
};

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

interface KpiConfig {
  metric?: string;
}

export function KpiPdf({ config, plans, span, branding, mc }: Props) {
  const cfg = (config ?? {}) as KpiConfig;
  const metric = cfg.metric ?? "lifetimeTax";
  const label =
    KPI_METRIC_LABELS[metric as keyof typeof KPI_METRIC_LABELS] ?? "—";

  return (
    <View style={{ ...s.wrap, width: SPAN_WIDTH[span] }}>
      <View style={s.tile}>
        <Text style={s.label}>{label}</Text>
        {plans.map((p, i) => {
          const raw = kpiMetricValue(metric, p, mc, i);
          return (
            <View key={p.id}>
              <Text style={{ ...s.value, color: branding.primaryColor }}>
                {raw === null ? "—" : formatKpi(metric, raw)}
              </Text>
              <Text style={s.plan}>{p.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
