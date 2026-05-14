// src/components/comparison-pdf/widgets/rmd-schedule.tsx
//
// PDF renderer for the "rmd-schedule" comparison widget.
//
// Layout: one DataTable per plan (mirroring snapshot-cell's per-plan layout).
// Columns: Year | Age | RMD Total
//
// The screen widget aggregates all per-account rmdAmounts into a single total
// per year (matching the table view in rmd-schedule-table.tsx). We do the same.
//
// Zero-RMD years are filtered out.
// yearRange filter is inclusive on both ends.
// compact mode is engaged when span ≤ 3.
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import { DataTable } from "@/components/pdf/widgets/data-table";
import type { DataTableColumn } from "@/components/pdf/widgets/data-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import { seriesColor } from "@/lib/comparison/series-palette";

const SPAN_WIDTH: Record<CellSpan, string> = {
  1: "20%",
  2: "40%",
  3: "60%",
  4: "80%",
  5: "100%",
};

const s = StyleSheet.create({
  wrap: { padding: 6 },
  planBlock: { marginBottom: 12 },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  planLabel: {
    fontFamily: "Inter",
    fontSize: 10,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
});

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

interface Row {
  year: string;
  age: string;
  rmd: string;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function totalRmd(year: ComparisonPlan["result"]["years"][number]): number {
  let total = 0;
  for (const led of Object.values(year.accountLedgers ?? {})) {
    total += (led as { rmdAmount?: number }).rmdAmount ?? 0;
  }
  return total;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { header: "Year", accessor: (r) => r.year, align: "left", width: "20%" },
  { header: "Age", accessor: (r) => r.age, align: "right", width: "20%" },
  { header: "RMD Total", accessor: (r) => r.rmd, align: "right", width: "60%" },
];

function buildRows(plan: ComparisonPlan, yearRange: YearRange | null): Row[] {
  let years = plan.result.years;
  if (yearRange) {
    years = years.filter((y) => y.year >= yearRange.start && y.year <= yearRange.end);
  }

  return years
    .filter((y) => totalRmd(y) > 0)
    .map((y) => ({
      year: String(y.year),
      age: y.ages?.client != null ? String(y.ages.client) : "—",
      rmd: usd.format(totalRmd(y)),
    }));
}

export function RmdSchedulePdf({ plans, yearRange, span }: Props) {
  const compact = span <= 3;
  const multiPlan = plans.length > 1;

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {plans.map((plan, idx) => {
        const rows = buildRows(plan, yearRange);
        const dotColor = seriesColor(idx) ?? PDF_THEME.ink3;

        return (
          <View key={plan.id} style={s.planBlock}>
            {multiPlan && (
              <View style={s.planHeader}>
                <View style={[s.dot, { backgroundColor: dotColor }]} />
                <Text style={s.planLabel}>{plan.label}</Text>
              </View>
            )}
            <DataTable<Row>
              columns={COLUMNS}
              rows={rows}
              compact={compact}
            />
          </View>
        );
      })}
    </View>
  );
}
