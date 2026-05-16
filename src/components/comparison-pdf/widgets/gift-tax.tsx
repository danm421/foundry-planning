// src/components/comparison-pdf/widgets/gift-tax.tsx
//
// PDF renderer for the "gift-tax" comparison widget.
//
// NOTE: The plan text for task 4.8 lists columns "Year, Gifts, Annual exclusion
// used, Lifetime exemption used, Lifetime exemption remaining". That is NOT
// what the screen widget renders. We mirror the screen widget exactly (same
// precedent as tasks 4.5, 4.6 and 4.7) — see
// src/components/comparison/gift-tax-comparison-section.tsx and
// src/components/gift-cumulative-table.tsx.
//
// Columns rendered here exactly match the on-screen GiftCumulativeTable:
//
//   No-spouse (9 cols):
//     Year | Age | Gifts Given | Taxable Gifts Given |
//     {Client} Cumul. Gifts | {Client} Credit Used | {Client} Gift Tax |
//     {Client} Cumul. Gift Tax | Gift Tax
//
//   With-spouse (13 cols):
//     Year | Age | Gifts Given | Taxable Gifts Given |
//     {Client} Cumul. Gifts | {Client} Credit Used | {Client} Gift Tax |
//     {Client} Cumul. Gift Tax |
//     {Spouse} Cumul. Gifts | {Spouse} Credit Used | {Spouse} Gift Tax |
//     {Spouse} Cumul. Gift Tax | Gift Tax
//
// The plan's "Annual exclusion used" / "Lifetime exemption used" /
// "Lifetime exemption remaining" don't map to the data the engine produces
// (annual exclusion is reconstructed via the drilldown panel, not stored in
// GiftLedgerYear), so we don't try to reverse-engineer them. The cumulative
// table is the primary content.
//
// DEFERRED: The screen widget's per-year DrilldownPanel (recipient detail
// subtable that the user can expand) is intentionally OUT OF SCOPE for the PDF
// pass. It uses interactive expand/collapse state and a `print:table-row`
// fallback for browser print. Porting it would require pulling
// buildRecipientDrilldown + its tree-derived data plumbing into the PDF tree.
// See future-work/reports.md.
//
// yearRange is intentionally NOT applied — the on-screen widget renders the
// full giftLedger and we preserve that behavior here. The prop is accepted
// for interface uniformity.
//
// Currency formatting: mirrors gift-cumulative-table's `fmt` — zero renders
// as an em-dash ("—") and non-zero uses Intl.NumberFormat USD with no decimals.
// This differs from balance-sheet / expense-detail (which use a plain
// `$${round}.toLocaleString()`); matching the screen widget keeps the PDF
// byte-identical for advisor-visible cells.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "@/components/pdf/theme";
import { DataTable } from "@/components/pdf/widgets/data-table";
import type { DataTableColumn } from "@/components/pdf/widgets/data-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import type { CellSpan, YearRange } from "@/lib/comparison/layout-schema";
import type { BrandingResolved } from "@/lib/comparison-pdf/branding";
import type { GiftLedgerYear, GrantorYearState } from "@/engine/gift-ledger";
import { seriesColor } from "@/lib/comparison/series-palette";
import { deriveOwnerNames, deriveOwnerDobs } from "@/lib/comparison/owner-info";

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

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function fmt(n: number): string {
  return n === 0 ? "—" : CURRENCY.format(n);
}

interface GiftRow {
  year: number;
  ageStr: string;
  giftsGiven: number;
  taxableGiftsGiven: number;
  client: GrantorYearState;
  spouse: GrantorYearState | null;
  totalGiftTax: number;
}

function ownerAgesFor(
  plan: ComparisonPlan,
): Record<number, { client: number; spouse?: number }> {
  const dobs = deriveOwnerDobs(plan.tree);
  const cYear = parseInt(dobs.clientDob.slice(0, 4), 10);
  const sYear = dobs.spouseDob ? parseInt(dobs.spouseDob.slice(0, 4), 10) : null;
  const out: Record<number, { client: number; spouse?: number }> = {};
  for (const ly of plan.result.giftLedger ?? []) {
    out[ly.year] = {
      client: ly.year - cYear,
      ...(sYear !== null ? { spouse: ly.year - sYear } : {}),
    };
  }
  return out;
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
  const ledger = (plan.result.giftLedger ?? []) as GiftLedgerYear[];
  const ownerNames = deriveOwnerNames(plan.tree);
  const hasSpouse = ownerNames.spouseName !== null;
  const ownerAges = ownerAgesFor(plan);

  const rows: GiftRow[] = ledger.map((row) => {
    const ages = ownerAges[row.year];
    const ageStr =
      hasSpouse && ages?.spouse != null
        ? `${ages.client}/${ages.spouse}`
        : `${ages?.client ?? ""}`;
    return {
      year: row.year,
      ageStr,
      giftsGiven: row.giftsGiven,
      taxableGiftsGiven: row.taxableGiftsGiven,
      client: row.perGrantor.client,
      spouse: row.perGrantor.spouse ?? null,
      totalGiftTax: row.totalGiftTax,
    };
  });

  const baseColumns: DataTableColumn<GiftRow>[] = [
    { header: "Year",                accessor: (r) => String(r.year),         align: "left"  },
    { header: "Age",                 accessor: (r) => r.ageStr,                align: "left"  },
    { header: "Gifts Given",         accessor: (r) => fmt(r.giftsGiven),       align: "right" },
    { header: "Taxable Gifts Given", accessor: (r) => fmt(r.taxableGiftsGiven), align: "right" },
    {
      header: `${ownerNames.clientName} Cumul. Gifts`,
      accessor: (r) => fmt(r.client.cumulativeTaxableGifts),
      align: "right",
    },
    {
      header: `${ownerNames.clientName} Credit Used`,
      accessor: (r) => fmt(r.client.creditUsed),
      align: "right",
    },
    {
      header: `${ownerNames.clientName} Gift Tax`,
      accessor: (r) => fmt(r.client.giftTaxThisYear),
      align: "right",
    },
    {
      header: `${ownerNames.clientName} Cumul. Gift Tax`,
      accessor: (r) => fmt(r.client.cumulativeGiftTax),
      align: "right",
    },
  ];

  const spouseColumns: DataTableColumn<GiftRow>[] = hasSpouse
    ? [
        {
          header: `${ownerNames.spouseName} Cumul. Gifts`,
          accessor: (r) => fmt(r.spouse?.cumulativeTaxableGifts ?? 0),
          align: "right",
        },
        {
          header: `${ownerNames.spouseName} Credit Used`,
          accessor: (r) => fmt(r.spouse?.creditUsed ?? 0),
          align: "right",
        },
        {
          header: `${ownerNames.spouseName} Gift Tax`,
          accessor: (r) => fmt(r.spouse?.giftTaxThisYear ?? 0),
          align: "right",
        },
        {
          header: `${ownerNames.spouseName} Cumul. Gift Tax`,
          accessor: (r) => fmt(r.spouse?.cumulativeGiftTax ?? 0),
          align: "right",
        },
      ]
    : [];

  const totalColumn: DataTableColumn<GiftRow> = {
    header: "Gift Tax",
    accessor: (r) => fmt(r.totalGiftTax),
    align: "right",
  };

  const columns: DataTableColumn<GiftRow>[] = [
    ...baseColumns,
    ...spouseColumns,
    totalColumn,
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
      <DataTable<GiftRow> columns={columns} rows={rows} compact={compact} />
    </View>
  );
}

export function GiftTaxPdf({
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
