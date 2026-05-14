// src/components/comparison-pdf/widgets/year-by-year.tsx
//
// PDF renderer for the "year-by-year" comparison widget.
//
// Layout: one DataTable per plan (mirroring snapshot-cell's per-plan layout).
// Columns: Year | Age | Income | Expenses | Taxes | Ending Balance.
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
  income: string;
  expenses: string;
  taxes: string;
  ending: string;
}

/** Format a number as compact currency: $1.2M, $123K, $1,234 */
function fmtCurrencyCompact(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    return `${sign}$${Math.round(abs / 1_000)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

const COLUMNS: DataTableColumn<Row>[] = [
  { header: "Year", accessor: (r) => r.year, align: "left", width: "12%" },
  { header: "Age", accessor: (r) => r.age, align: "right", width: "10%" },
  { header: "Income", accessor: (r) => r.income, align: "right", width: "20%" },
  { header: "Expenses", accessor: (r) => r.expenses, align: "right", width: "20%" },
  { header: "Taxes", accessor: (r) => r.taxes, align: "right", width: "18%" },
  { header: "Ending Balance", accessor: (r) => r.ending, align: "right", width: "20%" },
];

function buildRows(
  plan: ComparisonPlan,
  yearRange: YearRange | null,
): Row[] {
  let years = plan.result.years;
  if (yearRange) {
    years = years.filter((y) => y.year >= yearRange.start && y.year <= yearRange.end);
  }

  return years.map((y) => {
    const taxes = y.taxResult?.flow?.totalTax;
    return {
      year: String(y.year),
      age: y.ages?.client != null ? String(y.ages.client) : "—",
      income: fmtCurrencyCompact(y.income.total),
      expenses: fmtCurrencyCompact(y.expenses.total),
      taxes: taxes != null ? fmtCurrencyCompact(taxes) : "—",
      ending: fmtCurrencyCompact(y.portfolioAssets.total),
    };
  });
}

export function YearByYearPdf({ plans, mc: _mc, yearRange, span }: Props) {
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
