import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { GroupedBarChartPdf } from "@/components/presentations/shared/grouped-bar-chart-pdf";
import { GroupedDetailTablePdf } from "@/components/presentations/shared/grouped-detail-table-pdf";
import { dataLight } from "@/brand";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsLadderPageData } from "@/lib/presentations/pages/early-years-ladder/types";
import type { Rung } from "@/lib/presentations/pages/early-years-ladder/rungs";

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
  footnote: { fontSize: 7, color: T.ink3, lineHeight: 1.35, marginTop: 4 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

// The plan as it stands is grey; every raised rung is green, deepening toward
// the top of the ladder. Fixed hexes rather than opacity — a printed PDF's alpha
// blend against cream paper is not the same colour on every printer.
const RAISED = ["#8ecdb0", "#4aad80", dataLight.green];

/** Always ends on the full green, so the top of the ladder reads the same
 *  whether the advisor set one extra rung or three. */
function ladderFills(rungs: Rung[]): string[] {
  const raised = RAISED.slice(
    Math.max(0, RAISED.length - rungs.filter((r) => !r.isCurrent).length),
  );
  let next = 0;
  return rungs.map((r) => (r.isCurrent ? dataLight.grey : (raised[next++] ?? dataLight.green)));
}

/** "Save 11%" · "Save 11% and Save 14%" · "Save 11%, Save 14% and Save 17%" */
function nameList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function EarlyYearsLadderPagePdf(input: RenderPdfInput<EarlyYearsLadderPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };
  const fills = ladderFills(data.rungs);

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
          <GroupedBarChartPdf
            caption="portfolio · chart in today's dollars · both units below"
            width={data.tidbits.length > 0 ? 355 : 505}
            height={195}
            series={data.rungs.map((r, i) => ({
              label: r.isCurrent ? `${r.label} (current plan)` : r.label,
              fill: fills[i],
            }))}
            groups={data.groups.map((g) => ({
              label: `Age ${g.age}`,
              values: g.bars.map((b) => b.value.today),
            }))}
          />

          {data.takeaway != null && (
            <View style={[s.takeaway, { borderLeftColor: accent.accent }]}>
              <Text style={s.takeawayText}>{data.takeaway}</Text>
            </View>
          )}

          <GroupedDetailTablePdf
            groups={data.groups}
            seriesHeaders={data.rungs.map((rung) =>
              rung.isCurrent ? `${rung.label} · current plan` : rung.label,
            )}
            quantity="Portfolio at each age"
          />

          {data.cappedRungLabels.length > 0 && (
            <Text style={s.footnote}>
              {`At ${nameList(data.cappedRungLabels)}, contributions reach the IRS annual limit — those bars show the capped amount.`}
            </Text>
          )}
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
