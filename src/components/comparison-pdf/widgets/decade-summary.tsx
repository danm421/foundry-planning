// src/components/comparison-pdf/widgets/decade-summary.tsx
//
// PDF renderer for the "decade-summary" comparison widget.
//
// Layout: one DataTable per plan, mirroring the screen widget layout.
// Columns: Decade | Income | Expenses | Taxes | Starting Balance | Ending Balance.
// Decade labels use the "NNNNs" format (e.g. "2020s") mirroring the screen.
// Starting balance = portfolioAssets.total of the FIRST year in the decade.
// Income / Expenses / Taxes = SUM across all years in the decade.
// Ending balance = portfolioAssets.total of the LAST year in the decade.
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
import { bucketByDecade } from "@/lib/comparison/decade-buckets";
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
  decade: string;
  starting: string;
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
  { header: "Decade",           accessor: (r) => r.decade,   align: "left",  width: "12%" },
  { header: "Starting Balance", accessor: (r) => r.starting, align: "right", width: "18%" },
  { header: "Income",           accessor: (r) => r.income,   align: "right", width: "17%" },
  { header: "Expenses",         accessor: (r) => r.expenses, align: "right", width: "17%" },
  { header: "Taxes",            accessor: (r) => r.taxes,    align: "right", width: "17%" },
  { header: "Ending Balance",   accessor: (r) => r.ending,   align: "right", width: "19%" },
];

function buildRows(plan: ComparisonPlan, yearRange: YearRange | null): Row[] {
  let years = plan.result.years;
  if (yearRange) {
    years = years.filter((y) => y.year >= yearRange.start && y.year <= yearRange.end);
  }

  const buckets = bucketByDecade(years);

  return buckets.map((bucket) => {
    const { decadeStart, years: bYears } = bucket;
    const firstYear = bYears[0];
    const lastYear = bYears[bYears.length - 1];

    const totalIncome   = bYears.reduce((s, y) => s + (y.income?.total ?? 0), 0);
    const totalExpenses = bYears.reduce((s, y) => s + (y.expenses?.total ?? 0), 0);
    const hasTax        = bYears.some((y) => y.taxResult?.flow?.totalTax != null);
    const totalTaxes    = bYears.reduce((s, y) => s + (y.taxResult?.flow?.totalTax ?? 0), 0);

    return {
      decade:   `${decadeStart}s`,
      starting: fmtCurrencyCompact(firstYear.portfolioAssets?.total ?? 0),
      income:   fmtCurrencyCompact(totalIncome),
      expenses: fmtCurrencyCompact(totalExpenses),
      taxes:    hasTax ? fmtCurrencyCompact(totalTaxes) : "—",
      ending:   fmtCurrencyCompact(lastYear.portfolioAssets?.total ?? 0),
    };
  });
}

export function DecadeSummaryPdf({ plans, mc: _mc, yearRange, span }: Props) {
  const compact   = span <= 3;
  const multiPlan = plans.length > 1;

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {plans.map((plan, idx) => {
        const rows     = buildRows(plan, yearRange);
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
