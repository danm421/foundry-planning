// src/components/comparison-pdf/widgets/kpi-strip.tsx
//
// PDF renderer for the legacy `kpi-strip` widget kind.
// The v3→v4 migration expands kpi-strip into individual `kpi` cells, but legacy
// layouts may still reference this kind so we keep a native PDF renderer rather
// than falling back to SnapshotCell.
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

// Mirror the default set from migrate-to-v4.ts (all 5 KpiMetricKey values).
const DEFAULT_METRICS: string[] = [
  "successProbability",
  "longevityAge",
  "endNetWorth",
  "lifetimeTax",
  "netToHeirs",
];

const s = StyleSheet.create({
  wrap: { padding: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tile: {
    borderWidth: 0.5,
    borderColor: PDF_THEME.hair,
    padding: 8,
    minWidth: 110,
    flexGrow: 1,
  },
  label: {
    fontFamily: "JetBrains Mono",
    fontSize: 7,
    color: PDF_THEME.ink3,
  },
  value: {
    fontFamily: "Fraunces",
    fontSize: 14,
    fontWeight: 700,
    marginTop: 2,
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

interface StripConfig {
  metrics?: string[];
}

export function KpiStripPdf({ config, plans, span, branding, mc }: Props) {
  const cfg = (config ?? {}) as StripConfig;
  const metrics =
    cfg.metrics && cfg.metrics.length > 0 ? cfg.metrics : DEFAULT_METRICS;
  const plan = plans[0] ?? null;

  return (
    <View style={{ ...s.wrap, width: SPAN_WIDTH[span] }}>
      <View style={s.row}>
        {metrics.map((m) => {
          const label =
            KPI_METRIC_LABELS[m as keyof typeof KPI_METRIC_LABELS] ?? "—";
          const raw = plan ? kpiMetricValue(m, plan, mc, 0) : null;
          return (
            <View key={m} style={s.tile}>
              <Text style={s.label}>{label}</Text>
              <Text style={{ ...s.value, color: branding.primaryColor }}>
                {raw === null ? "—" : formatKpi(m, raw)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
