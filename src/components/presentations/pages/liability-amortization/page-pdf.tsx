import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, ZEBRA_FILL, type SectionAccent } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  AmortizationTableRow,
  LiabilityAmortizationPageData,
  LoanAmortizationSection,
} from "@/lib/presentations/pages/liability-amortization/types";
import {
  PAGE_TITLE,
  liabilityAmortizationTocSections,
  loanTitle,
} from "@/lib/presentations/pages/liability-amortization/view-model";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import { CashflowChartPdf } from "../cash-flow/chart-pdf";

const S = StyleSheet.create({
  facts: { flexDirection: "row", gap: 28, marginBottom: 8 },
  factLabel: {
    fontFamily: "Inter",
    fontSize: 6.5,
    color: T.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  factValue: { fontFamily: "Inter", fontSize: 10, fontWeight: 600, color: T.ink },
  table: { marginTop: 8 },
  headerRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: T.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 1, // color set inline to the section accent
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  row: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: T.hair2,
    borderRightColor: T.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
    paddingVertical: 2.5,
    paddingHorizontal: 6,
  },
  totalRow: { borderTopWidth: 1 }, // color set inline to the section accent
  th: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 600, color: T.ink },
  td: { fontFamily: "Inter", fontSize: 7.5, color: T.ink2 },
  strong: { fontWeight: 600, color: T.ink },
  year: { width: 48 },
  num: { flex: 1, textAlign: "right" },
  footnote: { marginTop: 8, fontFamily: "Inter", fontSize: 7, color: T.ink3 },
  empty: { marginTop: 12, fontFamily: "Inter", fontSize: 9, color: T.ink3 },
});

interface Column {
  key: "payment" | "interest" | "principal" | "extraPayment" | "endingBalance";
  header: string;
}

/** The schedule's money columns after Year. Extra prints only for a loan that
 *  has an extra payment. */
const COLUMNS: Column[] = [
  { key: "payment", header: "Payment" },
  { key: "interest", header: "Interest" },
  { key: "principal", header: "Principal" },
  { key: "extraPayment", header: "Extra" },
  { key: "endingBalance", header: "Balance" },
];

type Frame = Pick<
  RenderPdfInput<LiabilityAmortizationPageData>,
  "firmName" | "clientName" | "reportDate" | "pageIndex" | "totalPages"
>;

export function LiabilityAmortizationPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<LiabilityAmortizationPageData>) {
  const frame: Frame = { firmName, clientName, reportDate, pageIndex, totalPages };
  if (data.loans.length === 0) {
    return (
      <PageFrame {...frame}>
        <SectionHead title={PAGE_TITLE} subtitle={data.subtitle} accent={accent} />
        <Text style={S.empty}>No amortizing loans on this plan.</Text>
      </PageFrame>
    );
  }

  // The same start sheets the Contents lists, so its page numbers cannot drift.
  const starts = liabilityAmortizationTocSections(data).map((s) => s.offset);
  return (
    <>
      {data.loans.map((loan, i) => {
        const start = starts[i];
        return loan.sheets.map((rows, sheet) => (
          <LoanSheet
            key={`${loan.liabilityId}-${sheet}`}
            frame={{ ...frame, pageIndex: pageIndex + start + sheet }}
            accent={accent}
            loan={loan}
            rows={rows}
            subtitle={data.subtitle}
            isFirst={sheet === 0}
            isLast={sheet === loan.sheets.length - 1}
          />
        ));
      })}
    </>
  );
}

function LoanSheet({
  frame,
  accent,
  loan,
  rows,
  subtitle,
  isFirst,
  isLast,
}: {
  frame: Frame;
  accent: SectionAccent;
  loan: LoanAmortizationSection;
  rows: AmortizationTableRow[];
  subtitle: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const columns = loan.totals.extraPayment > 0 ? COLUMNS : COLUMNS.filter((c) => c.key !== "extraPayment");
  return (
    <PageFrame {...frame}>
      <SectionHead
        title={isFirst ? loanTitle(loan) : `${loanTitle(loan)} (continued)`}
        subtitle={subtitle}
        accent={accent}
      />
      {isFirst && (
        <>
          <View style={S.facts}>
            {loan.facts.map((f) => (
              <View key={f.label}>
                <Text style={S.factLabel}>{f.label}</Text>
                <Text style={S.factValue}>{f.value}</Text>
              </View>
            ))}
          </View>
          <CashflowChartPdf spec={loan.chartSpec} />
        </>
      )}
      <View style={S.table}>
        <View style={[S.headerRow, { backgroundColor: accent.tint, borderBottomColor: accent.accent }]}>
          <Text style={[S.th, S.year]}>Year</Text>
          {columns.map((c) => (
            <Text key={c.key} style={[S.th, S.num]}>{c.header}</Text>
          ))}
        </View>
        {rows.map((r, i) => (
          <ScheduleRow key={r.year} row={r} columns={columns} zebra={i % 2 === 1} accent={accent} />
        ))}
        {isLast && (
          <View style={[S.row, S.totalRow, { borderTopColor: accent.accent }]}>
            <Text style={[S.td, S.strong, S.year]}>Total</Text>
            {columns.map((c) => (
              <Text key={c.key} style={[S.td, S.strong, S.num]}>
                {c.key === "endingBalance" ? "" : exactCurrency(loan.totals[c.key])}
              </Text>
            ))}
          </View>
        )}
      </View>
      {isLast && loan.footnote && <Text style={S.footnote}>{loan.footnote}</Text>}
    </PageFrame>
  );
}

function ScheduleRow({
  row,
  columns,
  zebra,
  accent,
}: {
  row: AmortizationTableRow;
  columns: Column[];
  zebra: boolean;
  accent: SectionAccent;
}) {
  // This year's row is tinted, as the dialog's Amortization tab highlights it,
  // so the client can find where the loan stands today.
  const fill = row.isCurrentYear ? accent.tint : zebra ? ZEBRA_FILL : undefined;
  const td = row.isCurrentYear ? [S.td, S.strong] : [S.td];
  return (
    <View style={[S.row, fill ? { backgroundColor: fill } : {}]} wrap={false}>
      <Text style={[...td, S.year]}>{String(row.year)}</Text>
      {columns.map((c) => (
        <Text key={c.key} style={[...td, S.num]}>
          {c.key === "extraPayment" && row.extraPayment === 0 ? "—" : exactCurrency(row[c.key])}
        </Text>
      ))}
    </View>
  );
}
