import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type {
  AssumptionsPageData,
  AssumptionsSection,
  CategoryGrowthRow,
  AccountGrowthRow,
  ReferencedPortfolio,
  CmaRow,
  AssumptionRow,
} from "@/lib/presentations/pages/assumptions/types";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PRESENTATION_THEME.accent,
    letterSpacing: 0.4,
    marginTop: 8,
    marginBottom: 4,
  },
  // Two-column band of KV mini-tables
  kvGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  kvCard: {
    width: "48%",
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair2,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  kvHeading: { fontFamily: "Fraunces", fontSize: 12, fontWeight: 600, color: PRESENTATION_THEME.ink, marginBottom: 6 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  kvLabel: { fontFamily: "Inter", fontSize: 8.5, color: PRESENTATION_THEME.ink3 },
  kvValue: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink },
  // Generic table
  table: { marginBottom: 12 },
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
    borderBottomColor: PRESENTATION_THEME.accent,
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
  th: { fontFamily: "Inter", fontSize: 8, fontWeight: 700, color: PRESENTATION_THEME.ink },
  td: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink2 },
  right: { textAlign: "right" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: PRESENTATION_THEME.card,
    borderWidth: 0.5,
    borderColor: PRESENTATION_THEME.hair2,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  chipNum: { fontFamily: "JetBrains Mono", fontSize: 8, color: PRESENTATION_THEME.accent },
  chipText: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink },
  portfolioBlock: { marginBottom: 10 },
  portfolioTitle: { fontFamily: "Inter", fontSize: 9.5, fontWeight: 700, color: PRESENTATION_THEME.ink, marginBottom: 3 },
  footnote: { fontFamily: "Inter", fontSize: 7.5, color: PRESENTATION_THEME.ink3, marginTop: 8, fontStyle: "italic" },
});

function KvCard({ section }: { section: AssumptionsSection }) {
  return (
    <View style={styles.kvCard} wrap={false}>
      <Text style={styles.kvHeading}>{section.heading}</Text>
      {section.rows.map((r, i) => (
        <View key={i} style={styles.kvRow}>
          <Text style={styles.kvLabel}>{r.label}</Text>
          <Text style={styles.kvValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function CategoryGrowthTable({ rows }: { rows: CategoryGrowthRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { flex: 1.2 }]}>Category</Text>
        <Text style={[styles.th, { flex: 2 }]}>Source</Text>
        <Text style={[styles.th, { width: 60 }, styles.right]}>Rate</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.dataRow} wrap={false}>
          <Text style={[styles.td, { flex: 1.2 }]}>{r.category}</Text>
          <Text style={[styles.td, { flex: 2 }]}>{r.source}</Text>
          <Text style={[styles.td, { width: 60 }, styles.right]}>{r.rate}</Text>
        </View>
      ))}
    </View>
  );
}

function StressTable({ rows }: { rows: AssumptionRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { flex: 1.2 }]}>Stress test</Text>
        <Text style={[styles.th, { flex: 2.5 }]}>Effect</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.dataRow} wrap={false}>
          <Text style={[styles.td, { flex: 1.2 }]}>{r.label}</Text>
          <Text style={[styles.td, { flex: 2.5 }]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function AccountsTable({ rows, showValues }: { rows: AccountGrowthRow[]; showValues: boolean }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { flex: 2 }]}>Account</Text>
        <Text style={[styles.th, { flex: 1.2 }]}>Category</Text>
        {showValues && <Text style={[styles.th, { flex: 1 }, styles.right]}>Value</Text>}
        <Text style={[styles.th, { width: 55 }, styles.right]}>Rate</Text>
        <Text style={[styles.th, { flex: 1.8 }]}>Source</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.dataRow} wrap={false}>
          <Text style={[styles.td, { flex: 2 }]}>{r.name}</Text>
          <Text style={[styles.td, { flex: 1.2 }]}>{r.category}</Text>
          {showValues && <Text style={[styles.td, { flex: 1 }, styles.right]}>{r.value == null ? "—" : exactCurrency(r.value)}</Text>}
          <Text style={[styles.td, { width: 55 }, styles.right]}>{r.rate}</Text>
          <Text style={[styles.td, { flex: 1.8 }]}>{r.source}</Text>
        </View>
      ))}
    </View>
  );
}

function PortfolioBlock({ p }: { p: ReferencedPortfolio }) {
  return (
    <View style={styles.portfolioBlock} wrap={false}>
      <Text style={styles.portfolioTitle}>{`${p.name}  ·  ${p.blendedReturn} blended`}</Text>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          <Text style={[styles.th, { flex: 2 }]}>Asset class</Text>
          <Text style={[styles.th, { width: 60 }, styles.right]}>Weight</Text>
          <Text style={[styles.th, { width: 60 }, styles.right]}>Return</Text>
        </View>
        {p.rows.map((r, i) => (
          <View key={i} style={styles.dataRow} wrap={false}>
            <Text style={[styles.td, { flex: 2 }]}>{r.assetClass}</Text>
            <Text style={[styles.td, { width: 60 }, styles.right]}>{r.weight}</Text>
            <Text style={[styles.td, { width: 60 }, styles.right]}>{r.classReturn}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CmaTable({ rows }: { rows: CmaRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { flex: 2 }]}>Asset class</Text>
        <Text style={[styles.th, { width: 80 }, styles.right]}>Exp. return</Text>
        <Text style={[styles.th, { width: 70 }, styles.right]}>Volatility</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.dataRow} wrap={false}>
          <Text style={[styles.td, { flex: 2 }]}>{r.assetClass}</Text>
          <Text style={[styles.td, { width: 80 }, styles.right]}>{r.expectedReturn}</Text>
          <Text style={[styles.td, { width: 70 }, styles.right]}>{r.volatility}</Text>
        </View>
      ))}
    </View>
  );
}

export function AssumptionsPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: AssumptionsPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  const showValues = data.accounts?.some((a) => a.value != null) ?? false;
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />

      <View style={styles.kvGrid}>
        {data.overviewSections.map((s, i) => (
          <KvCard key={i} section={s} />
        ))}
      </View>

      {data.categoryGrowth.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>GROWTH BY CATEGORY</Text>
          <CategoryGrowthTable rows={data.categoryGrowth} />
        </>
      )}

      {data.withdrawalOrder.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>WITHDRAWAL ORDER</Text>
          <View style={styles.chips}>
            {data.withdrawalOrder.map((name, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipNum}>{i + 1}</Text>
                <Text style={styles.chipText}>{name}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {data.stressTests.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>ACTIVE STRESS TESTS</Text>
          <StressTable rows={data.stressTests} />
        </>
      )}

      {data.accounts && data.accounts.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>ACCOUNT GROWTH RATES</Text>
          <AccountsTable rows={data.accounts} showValues={showValues} />
        </>
      )}

      {data.referencedPortfolios && data.referencedPortfolios.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>MODEL PORTFOLIOS</Text>
          {data.referencedPortfolios.map((p, i) => (
            <PortfolioBlock key={i} p={p} />
          ))}
        </>
      )}

      {data.cma && data.cma.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>CAPITAL MARKET ASSUMPTIONS</Text>
          <CmaTable rows={data.cma} />
        </>
      )}

      {data.showBaseCaseFootnote && (
        <Text style={styles.footnote}>
          Account growth rates and capital market assumptions reflect the base plan&apos;s investment setup.
        </Text>
      )}
    </PageFrame>
  );
}
