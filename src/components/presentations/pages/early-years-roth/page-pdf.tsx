import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  EarlyYearsRothPageData,
  RothRow,
} from "@/lib/presentations/pages/early-years-roth/types";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 12 },
  cols: { flexDirection: "row", gap: 14 },
  main: { flex: 1 },
  head: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: T.hair,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: T.hair2,
    paddingVertical: 7,
  },
  label: { flex: 1.6, fontSize: 9, color: T.ink },
  cell: { flex: 1, fontSize: 11, textAlign: "right" },
  cellBetter: { color: T.ink, fontWeight: 700 },
  cellOther: { color: T.ink2 },
  headCell: {
    flex: 1,
    fontSize: 7,
    color: T.ink2,
    fontWeight: 700,
    textAlign: "right",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  takeaway: {
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.hair2,
    borderLeftWidth: 3,
    borderRadius: 3,
    padding: 8,
    marginTop: 12,
  },
  takeawayText: { fontSize: 9, color: T.ink, lineHeight: 1.35 },
  footnote: { fontSize: 7, color: T.ink3, lineHeight: 1.35, marginTop: 8 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

/** Which column this row argues for. Ties mark neither, so the sheet never
 *  bolds a winner it does not have.
 *
 *  Exported only to be tested: it decides which cell is bolded, and font weight
 *  does not survive into extracted PDF text, so the render smoke test cannot
 *  see it. Bolding the losing column is the defect `betterIsLower` exists to
 *  prevent, and it would print silently. */
export function betterColumn(r: RothRow): "traditional" | "roth" | null {
  if (r.traditional === r.roth) return null;
  const tradWins = r.betterIsLower ? r.traditional < r.roth : r.traditional > r.roth;
  return tradWins ? "traditional" : "roth";
}

export function EarlyYearsRothPagePdf(input: RenderPdfInput<EarlyYearsRothPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  if (data.rows.length === 0) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>Roth or Traditional?</Text>
        <Text style={s.empty}>{data.emptyMessage}</Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>Roth or Traditional?</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      <View style={s.cols}>
        <View style={s.main}>
          <View style={s.head}>
            <Text style={s.label}> </Text>
            <Text style={s.headCell}>All traditional</Text>
            <Text style={s.headCell}>All Roth</Text>
          </View>

          {data.rows.map((r) => {
            const better = betterColumn(r);
            return (
              <View key={r.label} style={s.row}>
                <Text style={s.label}>{r.label}</Text>
                <Text style={[s.cell, better === "traditional" ? s.cellBetter : s.cellOther]}>
                  {exactCurrency(r.traditional)}
                </Text>
                <Text style={[s.cell, better === "roth" ? s.cellBetter : s.cellOther]}>
                  {exactCurrency(r.roth)}
                </Text>
              </View>
            );
          })}

          {data.takeaway != null && (
            <View style={[s.takeaway, { borderLeftColor: accent.accent }]}>
              <Text style={s.takeawayText}>{data.takeaway}</Text>
            </View>
          )}

          {data.spendingIsFixed && (
            <Text style={s.footnote}>
              This plan spends a fixed amount each year, so the two choices leave the same
              amount to spend and the difference shows up entirely in the tax bill.
            </Text>
          )}
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
