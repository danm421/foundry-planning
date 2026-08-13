// The four sections that make the argument: what changes, what it looks like,
// what it costs in risk, and whether it fits the client's documented profile.
// One `PageFrame` each — `estimateInvestmentProposalPageCount` reserved exactly
// one sheet per printed section, and a section that flows onto a second sheet
// silently breaks the deck's page numbering.
import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { Callout } from "@/components/presentations/shared/callout";
import { PRESENTATION_THEME as T, type SectionAccent } from "@/lib/presentations/theme";
import { DonutPdf } from "../asset-allocation/donut-pdf";
import { ScatterPdf } from "../portfolio-analysis/scatter-pdf";
import type { InvestmentProposalPageData } from "@/lib/presentations/pages/investment-proposal/view-model";
import type { RiskLevel } from "@/lib/investments/proposals/types";

export interface PageFrameProps {
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
}

export interface SectionProps {
  data: InvestmentProposalPageData;
  frame: PageFrameProps;
  accent: SectionAccent;
}

export const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const signedPct1 = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
/** Sign OUTSIDE the currency symbol — react-pdf will happily print "$-37,973",
 *  which reads as a typo on a page a client is handed. */
export const usd = (v: number | null) => {
  if (v === null) return "—";
  const n = Math.round(v);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
};

const RUNG_LABEL: Record<RiskLevel, string> = {
  conservative: "Conservative",
  moderately_conservative: "Moderately Conservative",
  moderate: "Moderate",
  moderately_aggressive: "Moderately Aggressive",
  aggressive: "Aggressive",
};

export const S = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  kpi: { flex: 1, borderWidth: 0.5, borderColor: T.hair2, borderRadius: 3, padding: 10 },
  kpiLabel: { fontSize: 7.5, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValue: { fontSize: 18, color: T.ink, fontFamily: "JetBrains Mono", marginTop: 4 },
  headCell: { fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5 },
  rowName: { flex: 2, fontSize: 8.5, color: T.ink },
  rowNum: { flex: 1, fontSize: 8.5, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  donutRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 14 },
  note: { fontSize: 8, color: T.ink3, marginTop: 10 },
});

export function Frame({ children, frame }: { children: ReactNode; frame: PageFrameProps }) {
  return <PageFrame {...frame}>{children}</PageFrame>;
}

export function VerdictSection({ data, frame, accent }: SectionProps) {
  const v = data.verdict;
  return (
    <Frame frame={frame}>
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />
      <View style={S.kpiRow}>
        <View style={S.kpi}>
          <Text style={S.kpiLabel}>Expected return</Text>
          <Text style={S.kpiValue}>{signedPct1(v.deltaReturn)}</Text>
        </View>
        <View style={S.kpi}>
          <Text style={S.kpiLabel}>Volatility</Text>
          <Text style={S.kpiValue}>{signedPct1(v.deltaVolatility)}</Text>
        </View>
        <View style={S.kpi}>
          <Text style={S.kpiLabel}>Cost to switch</Text>
          <Text style={S.kpiValue}>{usd(v.estimatedTax)}</Text>
        </View>
        <View style={S.kpi}>
          <Text style={S.kpiLabel}>Saved per year</Text>
          <Text style={S.kpiValue}>{usd(v.annualDollarsSaved)}</Text>
        </View>
      </View>
      <Callout accent={accent}>{v.headline}</Callout>
    </Frame>
  );
}

export function AllocationSection({ data, frame, accent }: SectionProps) {
  return (
    <Frame frame={frame}>
      <SectionHead title="Allocation" subtitle="Today, and proposed" accent={accent} />
      <View style={S.donutRow}>
        <DonutPdf spec={data.donuts.current} title="Current" />
        <DonutPdf spec={data.donuts.proposed} title="Proposed" />
      </View>
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 2 }]}>Asset class</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Current</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Proposed</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Change</Text>
      </View>
      {(data.snapshot?.compute.assetMixDelta ?? []).map((d) => (
        <View key={d.assetClassId} style={S.row}>
          <Text style={S.rowName}>{d.name}</Text>
          <Text style={S.rowNum}>{pct1(d.currentPct)}</Text>
          <Text style={S.rowNum}>{pct1(d.targetPct)}</Text>
          <Text style={S.rowNum}>{signedPct1(d.diffPct)}</Text>
        </View>
      ))}
    </Frame>
  );
}

export function RiskReturnSection({ data, frame, accent }: SectionProps) {
  const cur = data.snapshot?.compute.current;
  const prop = data.snapshot?.compute.proposed;
  // `realized` is null when the two portfolios share too little price history.
  // An em-dash is the honest answer; a zero would read as "no drawdown".
  const rows: { label: string; c: string; p: string }[] = [
    { label: "Expected return", c: pct1(cur?.cma.geometricReturn ?? 0), p: pct1(prop?.cma.geometricReturn ?? 0) },
    { label: "Volatility", c: pct1(cur?.cma.stdDev ?? 0), p: pct1(prop?.cma.stdDev ?? 0) },
    { label: "Sharpe", c: cur?.cma.sharpe?.toFixed(2) ?? "—", p: prop?.cma.sharpe?.toFixed(2) ?? "—" },
    { label: "Sortino", c: cur?.realized?.sortino.toFixed(2) ?? "—", p: prop?.realized?.sortino.toFixed(2) ?? "—" },
    { label: "Max drawdown", c: cur?.realized ? pct1(cur.realized.maxDrawdown) : "—", p: prop?.realized ? pct1(prop.realized.maxDrawdown) : "—" },
    { label: "Downside deviation", c: cur?.realized ? pct1(cur.realized.downsideDeviation) : "—", p: prop?.realized ? pct1(prop.realized.downsideDeviation) : "—" },
  ];
  return (
    <Frame frame={frame}>
      <SectionHead title="Risk &amp; return" subtitle="Where the proposal moves the portfolio" accent={accent} />
      <View style={{ alignItems: "center", marginBottom: 14 }}>
        <ScatterPdf spec={data.scatter} />
      </View>
      <View style={S.row}>
        <Text style={[S.headCell, { flex: 2 }]}>Measure</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Current</Text>
        <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Proposed</Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={S.row}>
          <Text style={S.rowName}>{r.label}</Text>
          <Text style={S.rowNum}>{r.c}</Text>
          <Text style={S.rowNum}>{r.p}</Text>
        </View>
      ))}
    </Frame>
  );
}

export function SuitabilitySection({ data, frame, accent }: SectionProps) {
  const s = data.snapshot?.suitability;
  const placement = (p: { level: RiskLevel; estimated: boolean } | null | undefined) =>
    p ? `${RUNG_LABEL[p.level]}${p.estimated ? " (estimated from volatility)" : ""}` : "—";
  return (
    <Frame frame={frame}>
      <SectionHead title="Suitability" subtitle="Against the documented profile" accent={accent} />
      <View style={S.row}>
        <Text style={S.rowName}>Client&apos;s documented profile</Text>
        <Text style={[S.rowNum, { flex: 2, textAlign: "left" }]}>
          {s?.clientLevel ? RUNG_LABEL[s.clientLevel] : "No profile on file"}
        </Text>
      </View>
      <View style={S.row}>
        <Text style={S.rowName}>Current holdings</Text>
        <Text style={[S.rowNum, { flex: 2, textAlign: "left" }]}>{placement(s?.currentPlacement)}</Text>
      </View>
      <View style={S.row}>
        <Text style={S.rowName}>Proposed portfolio</Text>
        <Text style={[S.rowNum, { flex: 2, textAlign: "left" }]}>{placement(s?.proposedPlacement)}</Text>
      </View>
      <View style={{ marginTop: 12 }}>
        <Callout accent={accent}>
          {s?.proposedMatchesProfile
            ? "The proposed portfolio sits on the client's documented rung."
            : "The proposed portfolio does not sit on the client's documented rung."}
        </Callout>
      </View>
    </Frame>
  );
}
