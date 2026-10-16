// src/components/balance-sheet-report-pdf/balance-sheet-pdf-document.tsx
//
// Print version of the on-screen Balance Sheet report. Each view mirrors its
// screen counterpart — Household: HouseholdSummaryPanel + HouseholdTable +
// OutOfEstateTable; By Entity: EntityBalanceSheets — and is fed the same
// models (report-model.ts), so the PDF shows exactly what the advisor sees.
import { Document, Page, View, Text, Image, Svg, Path, Circle, StyleSheet } from "@react-pdf/renderer";
import { colorsLight } from "@/brand";
import { PDF_THEME } from "../balance-sheet-report/tokens";
import type { BalanceSheetViewModel, DonutSlice, EntityGroup } from "../balance-sheet-report/view-model";
import type { HouseholdColumnsModel, OwnerColumns, OwnerColumnRow } from "../balance-sheet-report/household-columns";
import { ENTITY_TYPE_LABEL, isTrust } from "@/lib/balance-sheet/entity-groups";
import { donutArcPath, segmentAngles } from "@/lib/presentations/charts/donut-chart-spec";
import { exactCurrency as usd } from "@/lib/presentations/format";
import { groupBeneficiaries, hasTrustDetails, type TrustDetails } from "@/lib/balance-sheet/trust-details";

export type BalanceSheetPdfView =
  | {
      kind: "household";
      household: HouseholdColumnsModel;
      donut: DonutSlice[];
      outOfEstate: Pick<BalanceSheetViewModel, "outOfEstateOwnerRows" | "outOfEstateNetWorth" | "selectedYear">;
      clientLabel: string;
      spouseLabel: string | null;
    }
  | {
      kind: "entities";
      /** Already display-prepped and filtered, in screen order. */
      groups: EntityGroup[];
      trustDetails: TrustDetails[];
    };

export interface BalanceSheetPdfProps {
  clientName: string;
  /** e.g. "Household · End of 2030 · Ages 64 & 62". */
  subtitle: string;
  /** Scenario name when the advisor is viewing one other than the base case. */
  scenarioName: string | null;
  generatedAt: string;
  firmName: string | null;
  logoDataUrl: string | null;
  /** Firm accent (white-label) — headings and rules, never data. */
  accentColor: string;
  view: BalanceSheetPdfView;
}

const GOOD = colorsLight.good;
const CRIT = colorsLight.crit;
const NUM_COL = 78;

const styles = StyleSheet.create({
  page: {
    backgroundColor: PDF_THEME.surface.page,
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 48,
    color: PDF_THEME.text.primary,
    fontFamily: "Helvetica",
    fontSize: 9,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1.5,
    paddingBottom: 10,
    marginBottom: 14,
  },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  subtitle: { color: PDF_THEME.text.secondary, fontSize: 10, marginTop: 3 },
  meta: { color: PDF_THEME.text.muted, fontSize: 8, marginTop: 2 },
  logo: { height: 28, maxWidth: 140, objectFit: "contain" },
  panel: {
    borderWidth: 1,
    borderColor: PDF_THEME.surface.panelBorder,
    borderRadius: 4,
    backgroundColor: PDF_THEME.surface.page,
  },
  eyebrow: {
    fontSize: 7,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: PDF_THEME.text.muted,
  },
  num: { textAlign: "right" },
  muted: { color: PDF_THEME.text.muted },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: PDF_THEME.text.muted,
  },

  // Summary (pie + net worth by owner)
  summary: { flexDirection: "row", marginBottom: 12 },
  summaryCell: { flex: 1, padding: 10 },
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  swatch: { width: 7, height: 7, borderRadius: 1, marginRight: 5 },

  // Household table
  tr: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: 0.5,
    borderTopColor: PDF_THEME.surface.divider,
    paddingVertical: 3.5,
    paddingHorizontal: 8,
  },
  th: {
    flexDirection: "row",
    backgroundColor: PDF_THEME.surface.panelHeader,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1.2,
    borderTopColor: colorsLight.hair2,
    backgroundColor: PDF_THEME.surface.panelHeader,
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontFamily: "Helvetica-Bold",
  },
  nameCell: { flex: 1, paddingRight: 6 },
  numCell: { width: NUM_COL, textAlign: "right" },
  categoryLabel: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  badge: { fontSize: 7, color: colorsLight.ink2 },
  subLine: { fontSize: 7, color: PDF_THEME.text.muted, marginTop: 1 },

  // Entities
  entityRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  entityCard: { width: 300, marginRight: 12 },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: PDF_THEME.surface.panelHeader,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  chip: {
    fontSize: 6.5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: PDF_THEME.text.muted,
    borderWidth: 0.5,
    borderColor: colorsLight.hair2,
    borderRadius: 2,
    paddingHorizontal: 3,
    paddingVertical: 1,
    marginLeft: 5,
  },
  detailsCard: { flex: 1 },
  detailLine: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  detailValue: { color: PDF_THEME.text.secondary, textAlign: "right", maxWidth: 150 },
});

/** Household tables print a zero as a dash, like the screen. */
const fmt = (n: number) => (n === 0 ? "—" : usd(n));
const neg = (n: number) => (n === 0 ? "—" : `(${fmt(n)})`);

// ── Pie ─────────────────────────────────────────────────────────────────────

function Pie({ slices, size }: { slices: DonutSlice[]; size: number }) {
  const r = size / 2;
  if (slices.length === 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={r} cy={r} r={r} fill={slices[0].hex} />
      </Svg>
    );
  }
  const angles = segmentAngles(slices.map((s) => s.value));
  return (
    <Svg width={size} height={size}>
      {slices.map((s, i) => (
        <Path key={s.key} d={donutArcPath(r, r, 0, r, angles[i].start, angles[i].end)} fill={s.hex} stroke="#ffffff" strokeWidth={1} />
      ))}
    </Svg>
  );
}

// ── Household ───────────────────────────────────────────────────────────────

function HouseholdSummary({ view }: { view: Extract<BalanceSheetPdfView, { kind: "household" }> }) {
  const { donut, household, clientLabel, spouseLabel } = view;
  const assetTotal = donut.reduce((sum, s) => sum + s.value, 0);
  const slices = assetTotal > 0 ? donut.filter((s) => s.value > 0) : [];
  const showSplit = household.hasSpouse && spouseLabel != null;
  const owners: { label: string; key: keyof OwnerColumns; strong?: boolean }[] = [
    { label: clientLabel, key: "client" },
    ...(showSplit ? [{ label: spouseLabel!, key: "spouse" as const }, { label: "Joint", key: "joint" as const }] : []),
    { label: "Total", key: "total", strong: true },
  ];

  return (
    <View style={[styles.panel, styles.summary]} wrap={false}>
      <View style={[styles.summaryCell, { borderRightWidth: 1, borderRightColor: PDF_THEME.surface.panelBorder }]}>
        <Text style={[styles.eyebrow, { marginBottom: 8 }]}>Assets by Type</Text>
        {slices.length === 0 ? (
          <Text style={[styles.muted, { paddingVertical: 20, textAlign: "center" }]}>No assets</Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pie slices={slices} size={96} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              {slices.map((s) => (
                <View key={s.key} style={styles.legendRow}>
                  <View style={[styles.swatch, { backgroundColor: s.hex }]} />
                  <Text style={{ flex: 1, color: PDF_THEME.text.secondary }}>{s.label}</Text>
                  <Text style={styles.muted}>{Math.round((s.value / assetTotal) * 100)}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      <View style={styles.summaryCell}>
        <Text style={[styles.eyebrow, { marginBottom: 8 }]}>Net Worth Summary</Text>
        <View style={{ flexDirection: "row", paddingBottom: 3 }}>
          <Text style={{ flex: 1 }} />
          {["Total Assets", "Total Liabilities", "Net Worth"].map((h) => (
            <Text key={h} style={[styles.eyebrow, { width: 64, textAlign: "right", fontSize: 6 }]}>{h}</Text>
          ))}
        </View>
        {owners.map((o) => {
          const nw = household.netWorth[o.key];
          return (
            <View
              key={o.key}
              style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: PDF_THEME.surface.divider, paddingVertical: 3 }}
            >
              <Text style={{ flex: 1, color: o.strong ? PDF_THEME.text.primary : PDF_THEME.text.secondary, fontFamily: o.strong ? "Helvetica-Bold" : "Helvetica" }}>
                {o.label}
              </Text>
              <Text style={{ width: 64, textAlign: "right" }}>{fmt(household.totalAssets[o.key])}</Text>
              <Text style={{ width: 64, textAlign: "right", color: CRIT }}>{neg(household.totalLiabilities[o.key])}</Text>
              <Text style={{ width: 64, textAlign: "right", color: nw < 0 ? CRIT : GOOD }}>{fmt(nw)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function HouseholdTable({
  view,
  accentColor,
}: {
  view: Extract<BalanceSheetPdfView, { kind: "household" }>;
  accentColor: string;
}) {
  const { household: model, clientLabel, spouseLabel } = view;
  const showSplit = model.hasSpouse && spouseLabel != null;
  /** "liability" prints red in parentheses; "netWorth" is green, or red below zero. */
  const cols = (c: OwnerColumns, tone?: "liability" | "netWorth") =>
    [c.client, ...(showSplit ? [c.spouse, c.joint] : []), c.total].map((v, i) => {
      const color = tone === "liability" ? CRIT : tone === "netWorth" ? (v < 0 ? CRIT : GOOD) : null;
      return (
        <Text key={i} style={color ? [styles.numCell, { color }] : styles.numCell}>
          {tone === "liability" ? neg(v) : fmt(v)}
        </Text>
      );
    });

  const row = (r: OwnerColumnRow, tone?: "liability") => (
    <View key={r.key} style={styles.tr} wrap={false}>
      <View style={[styles.nameCell, { paddingLeft: 12 }]}>
        <Text style={{ color: PDF_THEME.text.secondary }}>
          {r.name}
          {r.hasLinkedMortgage ? <Text style={styles.badge}>{"  (M)"}</Text> : null}
          {r.revocableTrustName ? <Text style={styles.badge}>{`  ·  ${r.revocableTrustName}`}</Text> : null}
        </Text>
        {(r.marginLoan ?? 0) > 0 ? <Text style={styles.subLine}>after {fmt(r.marginLoan!)} margin loan</Text> : null}
      </View>
      {cols(r, tone)}
    </View>
  );

  return (
    <View style={[styles.panel, { marginBottom: 12 }]}>
      <View style={styles.th} wrap={false}>
        <Text style={[styles.eyebrow, styles.nameCell]}>Category / Account</Text>
        {[clientLabel, ...(showSplit ? [spouseLabel!, "Joint"] : []), "Total"].map((h) => (
          <Text key={h} style={[styles.eyebrow, styles.numCell]}>{h}</Text>
        ))}
      </View>

      {model.assetCategories.map((cat) => (
        <View key={cat.key}>
          <View style={styles.tr} wrap={false} minPresenceAhead={24}>
            <Text style={[styles.nameCell, styles.categoryLabel, { color: accentColor }]}>{cat.label}</Text>
            {cols(cat)}
          </View>
          {cat.rows.map((r) => row(r))}
        </View>
      ))}
      <View style={styles.totalRow} wrap={false}>
        <Text style={styles.nameCell}>Total Assets</Text>
        {cols(model.totalAssets)}
      </View>

      {model.liabilityRows.length > 0 && (
        <>
          <View style={styles.tr} wrap={false} minPresenceAhead={24}>
            <Text style={[styles.nameCell, styles.categoryLabel, { color: accentColor }]}>Liabilities</Text>
          </View>
          {model.liabilityRows.map((r) => row(r, "liability"))}
        </>
      )}
      <View style={[styles.totalRow, { color: CRIT }]} wrap={false}>
        <Text style={styles.nameCell}>Total Liabilities</Text>
        {cols(model.totalLiabilities, "liability")}
      </View>
      <View style={styles.totalRow} wrap={false}>
        <Text style={styles.nameCell}>Net Worth</Text>
        {cols(model.netWorth, "netWorth")}
      </View>
    </View>
  );
}

function OutOfEstateTable({ vm }: { vm: Extract<BalanceSheetPdfView, { kind: "household" }>["outOfEstate"] }) {
  if (vm.outOfEstateOwnerRows.length === 0) return null;
  return (
    <View style={styles.panel} wrap={false}>
      <View style={styles.th}>
        <Text style={[styles.eyebrow, styles.nameCell]}>Out of Estate</Text>
        <Text style={[styles.eyebrow, styles.numCell]}>Net ({vm.selectedYear})</Text>
      </View>
      {vm.outOfEstateOwnerRows.map((r) => (
        <View key={r.ownerKey} style={styles.tr}>
          <Text style={[styles.nameCell, { color: PDF_THEME.text.secondary }]}>{r.ownerName}</Text>
          <Text style={r.net < 0 ? [styles.numCell, { color: CRIT }] : styles.numCell}>{fmt(r.net)}</Text>
        </View>
      ))}
      <View style={styles.totalRow}>
        <Text style={styles.nameCell}>Net Out of Estate</Text>
        <Text style={[styles.numCell, { color: vm.outOfEstateNetWorth < 0 ? CRIT : GOOD }]}>{fmt(vm.outOfEstateNetWorth)}</Text>
      </View>
    </View>
  );
}

// ── Entities ────────────────────────────────────────────────────────────────

function TrustDetailsCard({ details }: { details: TrustDetails }) {
  return (
    <View style={[styles.panel, styles.detailsCard]}>
      <View style={styles.cardHead}>
        <Text style={{ fontFamily: "Helvetica-Bold" }}>Trust Details</Text>
        {details.subTypeLabel ? <Text style={styles.chip}>{details.subTypeLabel}</Text> : null}
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
        {([["Trustee", details.trustee], ["Grantor", details.grantor]] as const).map(([label, value]) =>
          value ? (
            <View key={label} style={styles.detailLine}>
              <Text style={styles.muted}>{label}</Text>
              <Text style={styles.detailValue}>{value}</Text>
            </View>
          ) : null,
        )}
        {details.powers.length > 0 ? (
          <View style={styles.detailLine}>
            <Text style={styles.muted}>Powers</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 160 }}>
              {details.powers.map((p) => (
                <Text key={p} style={[styles.chip, { marginBottom: 2 }]}>{p}</Text>
              ))}
            </View>
          </View>
        ) : null}
        {groupBeneficiaries(details).map(({ group, rows }) => (
          <View key={group} style={{ marginTop: 2, marginBottom: 2 }}>
            <Text style={[styles.eyebrow, { marginBottom: 2 }]}>{group} beneficiaries</Text>
            {rows.map((b, i) => (
              <View key={`${b.name}-${i}`} style={[styles.detailLine, { marginBottom: 1.5 }]}>
                <Text style={{ color: PDF_THEME.text.secondary }}>{b.name}</Text>
                <Text>{b.percentage}%</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function EntityCards({ view }: { view: Extract<BalanceSheetPdfView, { kind: "entities" }> }) {
  if (view.groups.length === 0) {
    return <Text style={[styles.muted, { marginTop: 8 }]}>No business or trust entities.</Text>;
  }
  const detailsById = new Map(view.trustDetails.map((d) => [d.entityId, d]));
  return (
    <>
      {view.groups.map((g) => {
        const details = isTrust(g) ? detailsById.get(g.entityId) : undefined;
        return (
          <View key={g.entityId} style={styles.entityRow} wrap={false}>
            <View style={[styles.panel, styles.entityCard]}>
              <View style={styles.cardHead}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{g.entityName}</Text>
                  <Text style={styles.chip}>{ENTITY_TYPE_LABEL[g.entityType] ?? g.entityType}</Text>
                </View>
                <Text style={{ fontFamily: "Helvetica-Bold", color: g.netWorth < 0 ? CRIT : PDF_THEME.text.primary }}>
                  {usd(g.netWorth)}
                </Text>
              </View>
              {g.assetRows.map((r) => (
                <View key={r.rowKey} style={styles.tr}>
                  <View style={[styles.nameCell, { paddingLeft: 12 }]}>
                    <Text style={{ color: PDF_THEME.text.secondary }}>{r.accountName}</Text>
                    {(r.marginLoan ?? 0) > 0 ? (
                      <Text style={styles.subLine}>after {usd(r.marginLoan!)} margin loan</Text>
                    ) : null}
                  </View>
                  <Text style={styles.numCell}>{usd(r.value)}</Text>
                </View>
              ))}
              {g.liabilityRows.map((r) => (
                <View key={r.rowKey} style={styles.tr}>
                  <Text style={[styles.nameCell, { paddingLeft: 12, color: PDF_THEME.text.secondary }]}>{r.liabilityName}</Text>
                  <Text style={[styles.numCell, { color: CRIT }]}>({usd(r.balance)})</Text>
                </View>
              ))}
            </View>
            {details && hasTrustDetails(details) ? <TrustDetailsCard details={details} /> : null}
          </View>
        );
      })}
    </>
  );
}

// ── Document ────────────────────────────────────────────────────────────────

export function BalanceSheetPdfDocument(props: BalanceSheetPdfProps) {
  const { view } = props;
  const meta = [
    props.scenarioName ? `Scenario: ${props.scenarioName}` : null,
    `Prepared ${props.generatedAt}`,
    props.firmName,
  ].filter(Boolean);

  return (
    <Document title={`Balance Sheet — ${props.clientName}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={[styles.header, { borderBottomColor: props.accentColor }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Balance Sheet — {props.clientName}</Text>
            <Text style={styles.subtitle}>{props.subtitle}</Text>
            <Text style={styles.meta}>{meta.join(" · ")}</Text>
          </View>
          {props.logoDataUrl ? <Image src={props.logoDataUrl} style={styles.logo} /> : null}
        </View>

        {view.kind === "household" ? (
          <>
            <HouseholdSummary view={view} />
            <HouseholdTable view={view} accentColor={props.accentColor} />
            <OutOfEstateTable vm={view.outOfEstate} />
          </>
        ) : (
          <EntityCards view={view} />
        )}

        <View style={styles.footer} fixed>
          <Text>{props.clientName} · Balance Sheet</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
