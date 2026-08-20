import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { GroupedBarChartPdf } from "@/components/presentations/shared/grouped-bar-chart-pdf";
import { DetailTablePdf } from "@/components/presentations/shared/detail-table-pdf";
import { DualDollarValuePdf } from "@/components/presentations/shared/dual-dollar-value-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsWaitingPageData } from "@/lib/presentations/pages/early-years-waiting/types";

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
  detailText: { fontSize: 7, color: T.ink },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

// Starting now is the full green; every postponement pales toward it. The
// REVERSE of the ladder, and deliberately so: there the top bar is the good one,
// here the first is.
const DELAY_FILLS = [dataLight.green, "#8ecdb0", "#b9ddcb", "#d8ece2"];

export function EarlyYearsWaitingPagePdf(input: RenderPdfInput<EarlyYearsWaitingPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };
  const rate = Math.round(data.raisedRate * 100);
  const detailRows = data.groups.flatMap((group) =>
    group.bars.map((bar, index) => ({
      age: group.age,
      year: group.year,
      label: data.seriesLabels[index],
      bar,
    })),
  );

  if (data.groups.length === 0) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>The Cost of Waiting</Text>
        <Text style={s.empty}>{data.emptyMessage}</Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>The Cost of Waiting</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      <View style={s.cols}>
        <View style={s.main}>
          <GroupedBarChartPdf
            caption={`portfolio · chart in today's dollars · both units below · every bar saves ${rate}%`}
            width={data.tidbits.length > 0 ? 355 : 505}
            height={195}
            series={data.seriesLabels.map((label, i) => ({
              label,
              fill: DELAY_FILLS[i] ?? DELAY_FILLS[DELAY_FILLS.length - 1],
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

          <DetailTablePdf
            rows={detailRows}
            rowKey={(row) => `${row.age}-${row.label}`}
            rowPaddingVertical={1}
            columns={[
              {
                header: "Age / year",
                flex: 0.8,
                render: (row) => <Text style={s.detailText}>{`${row.age} · ${row.year}`}</Text>,
              },
              {
                header: "Start choice",
                flex: 1.1,
                render: (row) => <Text style={s.detailText}>{row.label}</Text>,
              },
              {
                header: "Portfolio",
                flex: 1.7,
                align: "right",
                render: (row) => (
                  <DualDollarValuePdf value={row.bar.value} nominalLabel={`in ${row.year}`} />
                ),
              },
            ]}
          />

          <Text style={s.footnote}>
            {`Every bar raises the same contribution to ${rate}% of pay — only the start date changes.`}
            {data.isCapped
              ? " That contribution reaches the IRS annual limit, so each bar shows the capped amount."
              : ""}
          </Text>
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
