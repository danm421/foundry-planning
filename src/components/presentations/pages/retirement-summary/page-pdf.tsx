import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { RetirementSummaryPageData } from "@/lib/presentations/pages/retirement-summary/view-model";
import type { SsClient } from "@/lib/presentations/pages/retirement-summary/social-security";
import { fmtUsd, fmtUsdMonthly } from "@/lib/presentations/pages/retirement-summary/aggregate";
import { PortfolioBarsPdf, SplitBarPdf } from "./chart-pdf";
import { CashflowChartPdf } from "../cash-flow/chart-pdf";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 6 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  kpi: { flexBasis: "31%", backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 10, marginBottom: 8 },
  twoCol: { flexDirection: "row", gap: 10 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 6, paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  lbl: { flex: 1, fontSize: 8, color: T.ink },
  val: { flexShrink: 0, fontSize: 8.5, fontWeight: 700, color: T.ink, textAlign: "right" },
  ssMeta: { fontSize: 7, color: T.ink3, marginBottom: 4 },
  ssName: { fontSize: 9, fontWeight: 700, color: T.ink },
  ssRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  ssRowSel: { backgroundColor: T.steel, borderRadius: 2 },
  ssCell: { fontSize: 8, color: T.ink },
  ssCellSel: { fontSize: 8, color: "#ffffff", fontWeight: 700 },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 2 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4 },
});

function Kpi({ lbl, val }: { lbl: string; val: string }) {
  return (<View style={s.kpi}><Text style={s.kpiLbl}>{lbl}</Text><Text style={s.kpiVal}>{val}</Text></View>);
}

function StatRow({ lbl, val }: { lbl: string; val: string }) {
  return (<View style={s.row}><Text style={s.lbl}>{lbl}</Text><Text style={s.val}>{val}</Text></View>);
}

function Narrative({ lines }: { lines: string[] }) {
  return (
    <View style={s.narr}>
      {lines.map((line, i) => (<Text key={i} style={s.narrText}>{i === 0 ? "Takeaways. " : ""}{line}</Text>))}
    </View>
  );
}

function SsColumn({ c }: { c: SsClient }) {
  return (
    <View>
      <Text style={s.ssName}>{c.name}</Text>
      <Text style={s.ssMeta}>{`PIA ${fmtUsdMonthly(c.piaMonthly)}/mo · claims at ${c.claimAge} · COLA ${Math.round(c.colaPct * 100)}%`}</Text>
      {c.alreadyClaiming ? (
        <View style={s.ssRow}>
          <Text style={s.ssCell}>Receiving</Text>
          <Text style={s.ssCell}>{`${fmtUsdMonthly(c.receivedMonthly ?? 0)}/mo`}</Text>
        </View>
      ) : (
        c.ladder.map((r) => (
          <View key={r.age} style={[s.ssRow, ...(r.selected ? [s.ssRowSel] : [])]}>
            <Text style={r.selected ? s.ssCellSel : s.ssCell}>{r.age}</Text>
            <Text style={r.selected ? s.ssCellSel : s.ssCell}>{`${fmtUsdMonthly(r.monthly)}/mo`}</Text>
          </View>
        ))
      )}
    </View>
  );
}

export function RetirementSummaryPagePdf(input: RenderPdfInput<RetirementSummaryPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages } = input;

  if (data.isEmpty) {
    return (
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="portrait">
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.empty}>No retirement data available for this scenario.</Text>
      </PageFrame>
    );
  }

  const f = data.funding;
  const fundingRows = data.fundingSources.filter((r) => r.value > 0);

  return (
    <>
      {/* ── PAGE 1 — Assets & Outlook ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="portrait">
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.subtitle}>{data.subtitle}</Text>

        <View style={s.kpis}>
          {/* Row 1: outlook — Monte Carlo, retirement timing, lifetime spend */}
          <Kpi lbl="Monte Carlo" val={data.kpis.monteCarlo} />
          <Kpi lbl="Retire age" val={`${data.kpis.retirementAge} · ${data.kpis.retirementYear}`} />
          <Kpi lbl="Total spend" val={fmtUsd(data.kpis.totalSpend)} />
          {/* Row 2: liquid portfolio at the three checkpoints */}
          <Kpi lbl="Liquid — Now" val={fmtUsd(data.kpis.liquidNow)} />
          <Kpi lbl="Liquid — Retire" val={fmtUsd(data.kpis.liquidRetirement)} />
          <Kpi lbl="Liquid — End" val={fmtUsd(data.kpis.liquidEndOfLife)} />
        </View>

        <View style={s.panel}>
          <Text style={s.h4}>Portfolio assets over time</Text>
          <PortfolioBarsPdf bars={data.bars} retirementYear={data.kpis.retirementYear} />
        </View>

        <View style={s.panel}>
          <Text style={s.h4}>{`Assets at retirement (${data.kpis.retirementYear})`}</Text>
          <View style={s.twoCol}>
            <View style={{ flex: 1 }}>
              <Text style={s.ssMeta}>By type</Text>
              <SplitBarPdf segments={[
                { label: "Cash", value: data.byType.cash, color: T.steel },
                { label: "Taxable", value: data.byType.taxable, color: T.accent },
                { label: "Retirement", value: data.byType.retirement, color: T.good },
              ]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.ssMeta}>By tax type</Text>
              <SplitBarPdf segments={[
                { label: "Roth", value: data.byTaxType.roth, color: T.good },
                { label: "Pre-tax", value: data.byTaxType.preTax, color: T.crit },
                { label: "Taxable", value: data.byTaxType.taxable, color: T.steel },
              ]} />
            </View>
          </View>
        </View>

        <Narrative lines={data.narrative} />
      </PageFrame>

      {/* ── PAGE 2 — Income, Spending & Funding ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="portrait">
        <Text style={s.title}>Income, Spending &amp; Funding</Text>

        <View style={s.panel}>
          <Text style={s.h4}>Cash flow in retirement</Text>
          <CashflowChartPdf spec={data.cashFlowChartSpec} />
        </View>

        <View style={s.panel}>
          <Text style={s.h4}>{`How retirement is funded (${data.kpis.retirementYear}–${data.bars[data.bars.length - 1]?.year ?? data.kpis.retirementYear})`}</Text>
          <SplitBarPdf segments={fundingRows.map((r, i) => ({
            label: r.label, value: r.value,
            color: [T.steel, T.good, T.accentMuted, dataLight.blue, T.accent, T.crit, T.good][i % 7],
          }))} />
          <StatRow lbl="Total cost of retirement" val={fmtUsd(f.totalSpending)} />
          {f.shortfall > 0 ? <StatRow lbl="Shortfall (unfunded)" val={fmtUsd(f.shortfall)} /> : null}
        </View>

        <View style={s.twoCol}>
          {data.socialSecurity.client ? (
            <View style={[s.panel, { flex: 1 }]}>
              <Text style={s.h4}>Social Security</Text>
              <SsColumn c={data.socialSecurity.client} />
            </View>
          ) : null}
          {data.socialSecurity.spouse ? (
            <View style={[s.panel, { flex: 1 }]}>
              <Text style={s.h4}>Social Security</Text>
              <SsColumn c={data.socialSecurity.spouse} />
            </View>
          ) : null}
          <View style={[s.panel, { flex: 1 }]}>
            <Text style={s.h4}>Retirement spending</Text>
            <StatRow lbl="Living — today" val={fmtUsd(data.living.today)} />
            <StatRow lbl="Living — at retirement" val={fmtUsd(data.living.retirement)} />
            {data.otherExpenses.insurance > 0 ? <StatRow lbl="Insurance" val={fmtUsd(data.otherExpenses.insurance)} /> : null}
            {data.otherExpenses.realEstate > 0 ? <StatRow lbl="Property tax" val={fmtUsd(data.otherExpenses.realEstate)} /> : null}
            {data.otherExpenses.liabilities > 0 ? <StatRow lbl="Debt service" val={fmtUsd(data.otherExpenses.liabilities)} /> : null}
          </View>
          <View style={[s.panel, { flex: 1 }]}>
            <Text style={s.h4}>Income in retirement</Text>
            {data.income.length ? data.income.map((r) => <StatRow key={r.id} lbl={r.label} val={fmtUsd(r.amount)} />)
              : <Text style={s.note}>No income streams continue past retirement.</Text>}
            {data.transactions.length ? (
              <>
                <Text style={[s.h4, { marginTop: 8 }]}>Asset transactions</Text>
                {data.transactions.map((t, i) => (
                  <StatRow key={`${t.year}-${i}`} lbl={`${t.year} · ${t.kind === "sale" ? "Sell" : "Buy"} ${t.name}`} val={fmtUsd(t.amount)} />
                ))}
              </>
            ) : null}
          </View>
        </View>
        {data.socialSecurity.client || data.socialSecurity.spouse ? (
          <Text style={s.note}>Highlighted row = the age the plan has them claiming. Amounts in today&apos;s dollars.</Text>
        ) : null}

        <Narrative lines={[data.narrative[0]]} />
      </PageFrame>
    </>
  );
}
