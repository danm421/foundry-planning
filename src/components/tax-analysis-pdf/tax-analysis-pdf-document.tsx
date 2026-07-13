// src/components/tax-analysis-pdf/tax-analysis-pdf-document.tsx
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { TaxAnalysis } from "@/lib/tax-analysis/analysis";
import type { Observation } from "@/lib/tax-analysis/types";
import { computeBracketBarLayout } from "@/lib/tax-analysis/bracket-map";
import { fmtUsd, fmtPct } from "@/lib/tax-analysis/format";
import { deductionDetailRows, incomeCompositionTotal } from "@/lib/tax-analysis/breakdowns";
import { PDF_THEME } from "@/components/balance-sheet-report/tokens";

export interface TaxAnalysisPdfProps {
  clientName: string;
  taxYear: number;
  generatedAt: string;
  analysis: TaxAnalysis;
  firmName?: string | null;
  logoDataUrl?: string | null; // from resolveBranding — base64 data URL or null
}

const GROUPS: Array<{ severity: Observation["severity"]; heading: string }> = [
  { severity: "opportunity", heading: "Opportunities" },
  { severity: "watch", heading: "Watch items" },
  { severity: "info", heading: "Notes" },
];

// Muted-slate fill for "amount filled" bars — deliberately not the Foundry
// verdigris accent. Client PDFs use the report's own light/print theme
// (see PDF_THEME), never Foundry's product-chrome brand color.
const BAR_FILL = PDF_THEME.text.secondary;
const BAR_FLOOR = PDF_THEME.text.muted;

const styles = StyleSheet.create({
  page: { backgroundColor: PDF_THEME.surface.page, padding: 32, color: PDF_THEME.text.primary, fontFamily: "Helvetica", fontSize: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: PDF_THEME.surface.divider, paddingBottom: 10, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: PDF_THEME.text.muted, fontSize: 10, marginTop: 2 },
  logo: { height: 28, objectFit: "contain" },
  figuresRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  panel: { flex: 1, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, backgroundColor: PDF_THEME.surface.panel, borderRadius: 4, padding: 8 },
  panelLabel: { fontSize: 7, textTransform: "uppercase", color: PDF_THEME.text.muted },
  panelValue: { fontSize: 13, fontWeight: "bold", marginTop: 2 },
  sectionHeading: { fontSize: 9, textTransform: "uppercase", color: PDF_THEME.text.muted, marginTop: 14, marginBottom: 6 },
  obsCard: { borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 4, padding: 8, marginBottom: 6 },
  obsTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 2 },
  obsBody: { fontSize: 9, color: PDF_THEME.text.primary, lineHeight: 1.4 },
  footer: { marginTop: 18, fontSize: 8, color: PDF_THEME.text.muted, lineHeight: 1.4 },

  // Bracket map
  bracketBlock: { marginBottom: 12 },
  bracketHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 },
  bracketBlockTitle: { fontSize: 9, fontWeight: "bold" },
  bracketCaption: { fontSize: 8, color: PDF_THEME.text.muted },
  bracketBarRow: { flexDirection: "row", height: 22, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 3, overflow: "hidden" },
  bracketSegment: { position: "relative", height: "100%", borderRightWidth: 0.5, borderRightColor: PDF_THEME.surface.panelBorder },
  bracketFill: { position: "absolute", top: 0, left: 0, bottom: 0, backgroundColor: BAR_FILL, opacity: 0.55 },
  bracketSegmentLabel: { fontSize: 7, textAlign: "center", marginTop: 6 },
  bracketFootnote: { fontSize: 8, color: PDF_THEME.text.muted, marginTop: 3 },
  capGainsBarWrap: { position: "relative", height: 22, borderWidth: 1, borderColor: PDF_THEME.surface.panelBorder, borderRadius: 3, overflow: "hidden" },
  capGainsFloor: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: BAR_FLOOR, opacity: 0.3 },
  capGainsFill: { position: "absolute", top: 0, bottom: 0, backgroundColor: BAR_FILL, opacity: 0.55 },
  capGainsMarker: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1.5, borderLeftColor: PDF_THEME.text.primary, borderLeftStyle: "dashed" },

  // Tables (income composition, deductions, YoY)
  table: { marginTop: 2 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: PDF_THEME.surface.divider, paddingBottom: 3, marginBottom: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: PDF_THEME.surface.divider, paddingVertical: 3 },
  tableLabelCell: { flex: 2, fontSize: 9 },
  tableValueCell: { flex: 1, fontSize: 9, textAlign: "right" },
  tableHeaderLabelCell: { flex: 2, fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase" },
  tableHeaderValueCell: { flex: 1, fontSize: 8, color: PDF_THEME.text.muted, textTransform: "uppercase", textAlign: "right" },
  tableTotalRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: PDF_THEME.surface.divider, paddingTop: 3, marginTop: 1 },
  tableTotalLabelCell: { flex: 2, fontSize: 9, fontWeight: "bold" },
  tableTotalValueCell: { flex: 1, fontSize: 9, fontWeight: "bold", textAlign: "right" },
});

function KeyFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>{label}</Text>
      <Text style={styles.panelValue}>{value}</Text>
    </View>
  );
}

function KeyFiguresRow({ analysis }: { analysis: TaxAnalysis }) {
  const k = analysis.keyFigures;
  const refundLabel = k.refund != null && k.refund > 0 ? "Refund" : "Owed at filing";
  const refundValue =
    k.refund != null && k.refund > 0
      ? fmtUsd(k.refund)
      : k.amountOwed != null ? fmtUsd(k.amountOwed) : "—";
  return (
    <View style={styles.figuresRow}>
      <KeyFigure label="Total income" value={k.totalIncome != null ? fmtUsd(k.totalIncome) : "—"} />
      <KeyFigure label="AGI" value={k.agi != null ? fmtUsd(k.agi) : "—"} />
      <KeyFigure label="Taxable income" value={k.taxableIncome != null ? fmtUsd(k.taxableIncome) : "—"} />
      <KeyFigure label="Total tax" value={k.totalTax != null ? fmtUsd(k.totalTax) : "—"} />
      <KeyFigure label="Effective rate" value={k.effectiveRate != null ? fmtPct(k.effectiveRate) : "—"} />
      <KeyFigure label="Marginal rate" value={k.marginalRate != null ? fmtPct(k.marginalRate) : "—"} />
      <KeyFigure label={refundLabel} value={refundValue} />
    </View>
  );
}

/** Swaps Tailwind divs for react-pdf Views on top of the same layout geometry
 *  the screen's BracketMapBars uses (bracket-map-bars.tsx) — both consume
 *  computeBracketBarLayout, so the taxBase=0 scaleTop guard (an all-LTCG
 *  retiree return can't produce NaN segment widths) lives in exactly one
 *  place. */
function BracketMapSection({ analysis }: { analysis: TaxAnalysis }) {
  const map = analysis.bracketMap;
  if (!map) return null;
  const layout = computeBracketBarLayout(map);

  return (
    <View>
      <View style={styles.bracketBlock}>
        <View style={styles.bracketHeaderRow}>
          <Text style={styles.bracketBlockTitle}>Ordinary income brackets</Text>
          <Text style={styles.bracketCaption}>{fmtUsd(map.ordinary.taxBase)} of ordinary taxable income</Text>
        </View>
        <View style={styles.bracketBarRow}>
          {layout.segments.map((seg) => (
            <View key={seg.from} style={[styles.bracketSegment, { width: `${seg.widthPct}%` }]}>
              <View style={[styles.bracketFill, { width: `${seg.fillPct}%` }]} />
              <Text style={styles.bracketSegmentLabel}>{fmtPct(seg.rate)}</Text>
            </View>
          ))}
        </View>
        {map.ordinary.headroomToNext != null && map.ordinary.nextRate != null && (
          <Text style={styles.bracketFootnote}>
            {fmtUsd(map.ordinary.headroomToNext)} of headroom remains at {fmtPct(map.ordinary.marginalRate)} before
            the {fmtPct(map.ordinary.nextRate)} bracket.
          </Text>
        )}
      </View>

      <View style={styles.bracketBlock}>
        <View style={styles.bracketHeaderRow}>
          <Text style={styles.bracketBlockTitle}>Long-term gains &amp; qualified dividends</Text>
          <Text style={styles.bracketCaption}>{fmtUsd(map.capGains.preferentialBase)} stacked on top of ordinary income</Text>
        </View>
        <View style={styles.capGainsBarWrap}>
          <View style={[styles.capGainsFloor, { width: `${layout.capGains.floorPct}%` }]} />
          <View
            style={[
              styles.capGainsFill,
              { left: `${layout.capGains.fillLeftPct}%`, width: `${layout.capGains.fillWidthPct}%` },
            ]}
          />
          <View style={[styles.capGainsMarker, { left: `${layout.capGains.markerLeftPct}%` }]} />
        </View>
        <Text style={styles.bracketFootnote}>
          Dashed line = top of the 0% bracket ({fmtUsd(map.capGains.zeroPctTop)}).{" "}
          {map.capGains.zeroPctHeadroom > 0
            ? `${fmtUsd(map.capGains.zeroPctHeadroom)} of gains could still be realized at 0%.`
            : "This return's income is above the 0% capital-gains bracket."}
        </Text>
      </View>
    </View>
  );
}

function IncomeCompositionSection({ analysis }: { analysis: TaxAnalysis }) {
  const rows = analysis.incomeComposition;
  if (!rows) return null;
  const total = incomeCompositionTotal(analysis.keyFigures.totalIncome);
  return (
    <View>
      <Text style={styles.sectionHeading}>Income composition</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.tableHeaderLabelCell}>Source</Text>
          <Text style={styles.tableHeaderValueCell}>Amount</Text>
          <Text style={styles.tableHeaderValueCell}>% of total</Text>
        </View>
        {rows.map((r) => (
          <View key={r.key} style={styles.tableRow}>
            <Text style={styles.tableLabelCell}>{r.label}</Text>
            <Text style={styles.tableValueCell}>{fmtUsd(r.amount)}</Text>
            <Text style={styles.tableValueCell}>{r.pctOfTotal != null ? fmtPct(r.pctOfTotal) : "—"}</Text>
          </View>
        ))}
        {total && (
          <View style={styles.tableTotalRow}>
            <Text style={styles.tableTotalLabelCell}>Total income</Text>
            <Text style={styles.tableTotalValueCell}>{total.amount}</Text>
            <Text style={styles.tableTotalValueCell}>{total.pct}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function DeductionsSection({ analysis }: { analysis: TaxAnalysis }) {
  const d = analysis.deductionDetail;
  if (!d) return null;
  return (
    <View>
      <Text style={styles.sectionHeading}>Deductions</Text>
      <View style={styles.table}>
        {deductionDetailRows(d).map((r) => (
          <View key={r.label} style={styles.tableRow}>
            <Text style={styles.tableLabelCell}>{r.label}</Text>
            <Text style={styles.tableValueCell}>{r.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ObservationsSection({ analysis }: { analysis: TaxAnalysis }) {
  return (
    <View>
      {GROUPS.map(({ severity, heading }) => {
        const items = analysis.observations.filter((o) => o.severity === severity);
        if (items.length === 0) return null;
        return (
          <View key={severity}>
            <Text style={styles.sectionHeading}>{heading}</Text>
            {items.map((o) => (
              <View key={o.id} style={styles.obsCard}>
                <Text style={styles.obsTitle}>{o.title}</Text>
                <Text style={styles.obsBody}>{o.body}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function YoYSection({ analysis, taxYear }: { analysis: TaxAnalysis; taxYear: number }) {
  if (!analysis.yoy) return null;
  const f = (v: number | null, kind: "money" | "rate") => (v == null ? "—" : kind === "rate" ? fmtPct(v) : fmtUsd(v));
  return (
    <View>
      <Text style={styles.sectionHeading}>Year over year</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.tableHeaderLabelCell}>Measure</Text>
          <Text style={styles.tableHeaderValueCell}>Prior</Text>
          <Text style={styles.tableHeaderValueCell}>{taxYear}</Text>
          <Text style={styles.tableHeaderValueCell}>Change</Text>
        </View>
        {analysis.yoy.map((r) => (
          <View key={r.label} style={styles.tableRow}>
            <Text style={styles.tableLabelCell}>{r.label}</Text>
            <Text style={styles.tableValueCell}>{f(r.prior, r.kind)}</Text>
            <Text style={styles.tableValueCell}>{f(r.current, r.kind)}</Text>
            <Text style={styles.tableValueCell}>{f(r.delta, r.kind)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function TaxAnalysisPdfDocument(props: TaxAnalysisPdfProps) {
  const { analysis: a } = props;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{props.taxYear} Tax Analysis</Text>
            <Text style={styles.subtitle}>
              {props.clientName} · Prepared {props.generatedAt}
              {props.firmName ? ` · ${props.firmName}` : ""}
            </Text>
          </View>
          {props.logoDataUrl ? <Image src={props.logoDataUrl} style={styles.logo} /> : null}
        </View>

        <KeyFiguresRow analysis={a} />

        <BracketMapSection analysis={a} />

        <IncomeCompositionSection analysis={a} />

        <DeductionsSection analysis={a} />

        <ObservationsSection analysis={a} />

        <YoYSection analysis={a} taxYear={props.taxYear} />

        <View style={styles.footer}>
          <Text>
            {a.reconstruction.withinTolerance === true
              ? "Cross-check: our independent computation of this return's pre-credit tax matches the filed amount. "
              : a.reconstruction.withinTolerance === false
                ? `Cross-check: our computed pre-credit tax (${fmtUsd(a.reconstruction.computedPreCreditTax ?? 0)}) differs from the filed amount — verify the extracted figures. `
                : ""}
            This analysis is informational, based on the return as provided, and is not tax advice.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
