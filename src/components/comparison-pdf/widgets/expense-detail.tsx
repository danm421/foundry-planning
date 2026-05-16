// src/components/comparison-pdf/widgets/expense-detail.tsx
//
// PDF renderer for the "expense-detail" comparison widget.
//
// NOTE: The plan text for task 4.7 lists columns "Category, Annual amount,
// Inflation-adjusted plan-year total". That is NOT what the screen widget
// renders. We mirror the screen widget exactly (same precedent as tasks 4.5
// and 4.6) — see src/components/comparison/expense-detail-comparison-section.tsx.
//
// Per plan, two tables are stacked:
//   1. Living expenses table — columns: Category | Current (<curY>) |
//      Retirement (<retY>). Rows = each expense whose type === "living".
//      Values come from plan.result.years[year].expenses.bySource[expenseId].
//      The final "Total Living Expenses" row sums each column.
//        curY = today's calendar year, clamped to the projection window.
//        retY = max retirement year derived from client/spouse DOB +
//               retirementAge; falls back to curY when client data is missing.
//   2. Events table — columns: Expense | Year(s) | Annual Amount. Rendered
//      only when at least one expense satisfies (type !== "living") AND
//      (endYear - startYear < 50). The Year(s) cell collapses to a single
//      year when startYear === endYear, otherwise shows "<start>–<end>"
//      with an en-dash. The Annual Amount uses expense.annualAmount
//      directly (no projection lookup).
//
// yearRange is intentionally NOT applied — the on-screen widget pins the
// columns to current/retirement years, and we preserve that behavior here.
// The prop is accepted for interface uniformity.
//
// Currency formatting: matches the screen widget exactly (`$${round}.toLocaleString()`)
// so per-row dollar strings stay byte-identical between PDF and screen views.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import { DataTable } from "@/components/pdf/widgets/data-table";
import type { DataTableColumn } from "@/components/pdf/widgets/data-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import type { ClientInfo, Expense, ProjectionYear } from "@/engine/types";
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
  tableSpacer: { height: 6 },
});

interface Props {
  config: unknown;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  span: CellSpan;
  branding: BrandingResolved;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function currentYear(years: ProjectionYear[]): number {
  const now = new Date().getUTCFullYear();
  if (years.length === 0) return now;
  const first = years[0].year;
  const last = years[years.length - 1].year;
  if (now < first) return first;
  if (now > last) return last;
  return now;
}

function retirementYear(client: ClientInfo | undefined): number | null {
  if (!client) return null;
  const a = client.dateOfBirth
    ? Number(client.dateOfBirth.slice(0, 4)) + (client.retirementAge ?? 0)
    : null;
  const b = client.spouseDob
    ? Number(client.spouseDob.slice(0, 4)) + (client.spouseRetirementAge ?? 0)
    : null;
  const candidates = [a, b].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function amountInYear(
  years: ProjectionYear[],
  expenseId: string,
  year: number,
): number {
  const y = years.find((r) => r.year === year);
  return y?.expenses?.bySource?.[expenseId] ?? 0;
}

interface LivingRow {
  category: string;
  current: string;
  retirement: string;
}

interface EventRow {
  expense: string;
  yearLabel: string;
  amount: string;
}

function PlanBlock({
  plan,
  index,
  multiPlan,
  compact,
}: {
  plan: ComparisonPlan;
  index: number;
  multiPlan: boolean;
  compact: boolean;
}) {
  const expenses = (plan.tree.expenses ?? []) as Expense[];
  const years = (plan.result.years ?? []) as ProjectionYear[];
  const client = plan.tree.client as ClientInfo | undefined;
  const curY = currentYear(years);
  const retY = retirementYear(client) ?? curY;

  const living = expenses.filter((e) => e.type === "living");
  const events = expenses.filter(
    (e) => e.type !== "living" && e.endYear - e.startYear < 50,
  );

  const livingRows: LivingRow[] = living.map((e) => ({
    category: e.name,
    current: fmt(amountInYear(years, e.id, curY)),
    retirement: fmt(amountInYear(years, e.id, retY)),
  }));

  const livingCurTotal = living.reduce(
    (sum, e) => sum + amountInYear(years, e.id, curY),
    0,
  );
  const livingRetTotal = living.reduce(
    (sum, e) => sum + amountInYear(years, e.id, retY),
    0,
  );

  const livingFooter: LivingRow = {
    category: "Total Living Expenses",
    current: fmt(livingCurTotal),
    retirement: fmt(livingRetTotal),
  };

  const livingColumns: DataTableColumn<LivingRow>[] = [
    { header: "Category",          accessor: (r) => r.category,   align: "left",  width: "50%" },
    { header: `Current (${curY})`, accessor: (r) => r.current,    align: "right", width: "25%" },
    { header: `Retirement (${retY})`, accessor: (r) => r.retirement, align: "right", width: "25%" },
  ];

  const eventRows: EventRow[] = events.map((e) => ({
    expense: e.name,
    yearLabel:
      e.startYear === e.endYear ? String(e.startYear) : `${e.startYear}–${e.endYear}`,
    amount: fmt(e.annualAmount),
  }));

  const eventColumns: DataTableColumn<EventRow>[] = [
    { header: "Expense",       accessor: (r) => r.expense,   align: "left",  width: "50%" },
    { header: "Year(s)",       accessor: (r) => r.yearLabel, align: "right", width: "25%" },
    { header: "Annual Amount", accessor: (r) => r.amount,    align: "right", width: "25%" },
  ];

  const dotColor = seriesColor(index) ?? PDF_THEME.ink3;

  return (
    <View style={s.planBlock}>
      {multiPlan && (
        <View style={s.planHeader}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.planLabel}>{plan.label}</Text>
        </View>
      )}
      <DataTable<LivingRow>
        columns={livingColumns}
        rows={livingRows}
        footerRow={livingFooter}
        compact={compact}
      />
      {eventRows.length > 0 && (
        <>
          <View style={s.tableSpacer} />
          <DataTable<EventRow>
            columns={eventColumns}
            rows={eventRows}
            compact={compact}
          />
        </>
      )}
    </View>
  );
}

export function ExpenseDetailPdf({
  plans,
  mc: _mc,
  yearRange: _yearRange,
  span,
}: Props) {
  const compact = span <= 3;
  const multiPlan = plans.length > 1;

  return (
    <View style={[s.wrap, { width: SPAN_WIDTH[span] }]}>
      {plans.map((plan, idx) => (
        <PlanBlock
          key={plan.id}
          plan={plan}
          index={idx}
          multiPlan={multiPlan}
          compact={compact}
        />
      ))}
    </View>
  );
}
