import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type {
  HoldingsPageData,
  AccountBlockVm,
  HoldingRowVm,
  FlatRowVm,
} from "@/lib/presentations/pages/holdings/types";
import { PRESENTATION_THEME, ZEBRA_FILL, type SectionAccent } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";

const styles = StyleSheet.create({
  // Summary band — three stat blocks
  summaryBand: { flexDirection: "row", gap: 12, marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair2,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  statLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 7,
    color: PRESENTATION_THEME.ink3,
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  statValue: { fontFamily: "Fraunces", fontSize: 14, fontWeight: 600, color: PRESENTATION_THEME.ink },
  // Account block header
  blockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 10,
    marginBottom: 3,
  },
  blockName: { fontFamily: "Inter", fontSize: 9.5, fontWeight: 700, color: PRESENTATION_THEME.ink },
  blockCategory: {
    fontFamily: "JetBrains Mono",
    fontSize: 6.5,
    color: PRESENTATION_THEME.ink3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginLeft: 6,
  },
  blockTotal: { fontFamily: "JetBrains Mono", fontSize: 8, color: PRESENTATION_THEME.ink2 },
  // Table
  table: { marginBottom: 6 },
  headerRow: {
    flexDirection: "row",
    backgroundColor: PRESENTATION_THEME.card,
    borderTopWidth: 1,
    borderTopColor: PRESENTATION_THEME.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  dataRow: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: PRESENTATION_THEME.hair2,
    paddingVertical: 3,
    paddingHorizontal: 3,
  },
  th: { fontFamily: "Inter", fontSize: 7, fontWeight: 700, color: PRESENTATION_THEME.ink },
  td: { fontFamily: "Inter", fontSize: 7.5, color: PRESENTATION_THEME.ink2 },
  num: { fontFamily: "JetBrains Mono", fontSize: 6.5, color: PRESENTATION_THEME.ink2 },
  right: { textAlign: "right" },
  tickerCell: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 600, color: PRESENTATION_THEME.ink },
  empty: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PRESENTATION_THEME.ink3,
    fontStyle: "italic",
    marginTop: 12,
  },
});

// Column widths shared by both modes (flat mode prepends Account).
const W = { ticker: 38, shares: 52, price: 52, value: 62, pct: 40, basis: 58, gain: 92 } as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function HeaderCells({ withAccount, withBasis, accent }: { withAccount: boolean; withBasis: boolean; accent: SectionAccent }) {
  return (
    <View style={[styles.headerRow, { borderBottomColor: accent.accent }]}>
      {withAccount && <Text style={[styles.th, { flex: 1.4 }]}>Account</Text>}
      <Text style={[styles.th, { width: W.ticker }]}>Ticker</Text>
      <Text style={[styles.th, { flex: 2 }]}>Name</Text>
      <Text style={[styles.th, { width: W.shares }, styles.right]}>Shares</Text>
      <Text style={[styles.th, { width: W.price }, styles.right]}>Price</Text>
      <Text style={[styles.th, { width: W.value }, styles.right]}>Market Value</Text>
      <Text style={[styles.th, { width: W.pct }, styles.right]}>% of Total</Text>
      {withBasis && <Text style={[styles.th, { width: W.basis }, styles.right]}>Cost Basis</Text>}
      {withBasis && <Text style={[styles.th, { width: W.gain }, styles.right]}>Gain/Loss</Text>}
    </View>
  );
}

const TONE_COLOR = {
  good: PRESENTATION_THEME.good,
  crit: PRESENTATION_THEME.crit,
  neutral: PRESENTATION_THEME.ink2,
} as const;

function RowCells({ row, withBasis }: { row: HoldingRowVm; withBasis: boolean }) {
  return (
    <>
      <Text style={[styles.tickerCell, { width: W.ticker }]}>{row.ticker || "—"}</Text>
      <Text style={[styles.td, { flex: 2 }]}>{row.name || "—"}</Text>
      <Text style={[styles.num, { width: W.shares }, styles.right]}>{row.shares}</Text>
      <Text style={[styles.num, { width: W.price }, styles.right]}>{row.price}</Text>
      <Text style={[styles.num, { width: W.value }, styles.right]}>{row.marketValue}</Text>
      <Text style={[styles.num, { width: W.pct }, styles.right]}>{row.pctOfTotal}</Text>
      {withBasis && (
        <Text style={[styles.num, { width: W.basis }, styles.right]}>{row.costBasis ?? "—"}</Text>
      )}
      {withBasis && (
        <Text style={[styles.num, { width: W.gain }, styles.right, { color: row.gainLoss ? TONE_COLOR[row.gainLoss.tone] : PRESENTATION_THEME.ink3 }]}>
          {row.gainLoss?.text ?? "—"}
        </Text>
      )}
    </>
  );
}

function AccountBlock({ block, withBasis, accent }: { block: AccountBlockVm; withBasis: boolean; accent: SectionAccent }) {
  return (
    <View>
      <View style={styles.blockHeader} wrap={false}>
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <Text style={styles.blockName}>{block.accountName}</Text>
          <Text style={styles.blockCategory}>{block.category}</Text>
        </View>
        <Text style={styles.blockTotal}>{`${block.totalValue} · ${block.pctOfTotal}`}</Text>
      </View>
      <View style={styles.table}>
        <HeaderCells withAccount={false} withBasis={withBasis} accent={accent} />
        {block.rows.map((row, i) => (
          <View key={i} style={[styles.dataRow, i % 2 ? { backgroundColor: ZEBRA_FILL } : {}]} wrap={false}>
            <RowCells row={row} withBasis={withBasis} />
          </View>
        ))}
      </View>
    </View>
  );
}

function FlatTable({ rows, withBasis, accent }: { rows: FlatRowVm[]; withBasis: boolean; accent: SectionAccent }) {
  return (
    <View style={styles.table}>
      <HeaderCells withAccount withBasis={withBasis} accent={accent} />
      {rows.map((row, i) => (
        <View key={i} style={[styles.dataRow, i % 2 ? { backgroundColor: ZEBRA_FILL } : {}]} wrap={false}>
          <Text style={[styles.td, { flex: 1.4 }]}>{row.accountName}</Text>
          <RowCells row={row} withBasis={withBasis} />
        </View>
      ))}
    </View>
  );
}

export function HoldingsPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: HoldingsPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />

      <View style={styles.summaryBand}>
        <Stat label="TOTAL VALUE" value={data.totalValue} />
        <Stat label="ACCOUNTS" value={String(data.accountCount)} />
        <Stat label="POSITIONS" value={String(data.positionCount)} />
      </View>

      {data.positionCount === 0 ? (
        <Text style={styles.empty}>No holdings on file.</Text>
      ) : data.accountBlocks ? (
        data.accountBlocks.map((block, i) => (
          <AccountBlock key={i} block={block} withBasis={data.includeCostBasis} accent={accent} />
        ))
      ) : (
        <FlatTable rows={data.flatRows ?? []} withBasis={data.includeCostBasis} accent={accent} />
      )}
    </PageFrame>
  );
}
