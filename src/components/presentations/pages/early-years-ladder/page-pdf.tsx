import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { LadderChartPdf } from "./ladder-chart-pdf";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsLadderPageData } from "@/lib/presentations/pages/early-years-ladder/types";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 12 },
  cols: { flexDirection: "row", gap: 14 },
  main: { flex: 1 },
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

/** "Save 11%" · "Save 11% and Save 14%" · "Save 11%, Save 14% and Save 17%" */
function nameList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function EarlyYearsLadderPagePdf(input: RenderPdfInput<EarlyYearsLadderPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  if (data.groups.length === 0) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>What Saving More Is Worth</Text>
        <Text style={s.empty}>{data.emptyMessage}</Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>What Saving More Is Worth</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      <View style={s.cols}>
        <View style={s.main}>
          <LadderChartPdf groups={data.groups} width={data.tidbits.length > 0 ? 355 : 505} />

          {data.takeaway != null && (
            <View style={[s.takeaway, { borderLeftColor: accent.accent }]}>
              <Text style={s.takeawayText}>{data.takeaway}</Text>
            </View>
          )}

          {data.cappedRungLabels.length > 0 && (
            <Text style={s.footnote}>
              {`At ${nameList(data.cappedRungLabels)}, contributions reach the IRS annual limit — those bars show the capped amount.`}
            </Text>
          )}
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} />
      </View>
    </PageFrame>
  );
}
