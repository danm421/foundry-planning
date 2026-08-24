import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import { HumanCapitalChartPdf } from "./human-capital-chart-pdf";
import { DetailTablePdf } from "@/components/presentations/shared/detail-table-pdf";
import {
  DualDollarValuePdf,
  dualDollarCaption,
} from "@/components/presentations/shared/dual-dollar-value-pdf";
import { fmtAxisUsd } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsHumanCapitalPageData } from "@/lib/presentations/pages/early-years-human-capital/types";

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
  unitLine: { fontSize: 7, color: T.ink2, marginTop: 3 },
  detailText: { fontSize: 7.5, color: T.ink },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

export function EarlyYearsHumanCapitalPagePdf(
  input: RenderPdfInput<EarlyYearsHumanCapitalPageData>,
) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  if (data.isEmpty) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>Your Biggest Asset Isn&apos;t Your Portfolio</Text>
        <Text style={s.empty}>
          This page weighs a portfolio against future pay. The plan projects no salary
          income, so there is no second bar to draw.
        </Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>Your Biggest Asset Isn&apos;t Your Portfolio</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      <View style={s.cols}>
        <View style={s.main}>
          <HumanCapitalChartPdf
            width={data.tidbits.length > 0 ? 355 : 505}
            bars={[
              { label: "Invested today", value: data.invested.today, fill: dataLight.grey },
              {
                label:
                  data.lastEarningYear != null
                    ? `Future pay, through ${data.lastEarningYear}`
                    : "Future pay",
                value: data.lifetimeEarnings.today,
                fill: dataLight.green,
              },
            ]}
          />

          <Text style={s.unitLine}>
            {`Future pay: ${fmtAxisUsd(data.lifetimeEarnings.today)} today · ${fmtAxisUsd(data.lifetimeEarnings.nominal)} future-year dollars`}
          </Text>

          <View style={[s.takeaway, { borderLeftColor: accent.accent }]}>
            <Text style={s.takeawayText}>{data.takeaway}</Text>
          </View>

          <DetailTablePdf
            rows={data.detailRows}
            rowKey={(row) => String(row.year)}
            caption={dualDollarCaption("Salary in each year")}
            columns={[
              {
                header: "Year / age",
                flex: 1,
                render: (row) => <Text style={s.detailText}>{`${row.year} · ${row.age}`}</Text>,
              },
              {
                header: "Salary",
                flex: 2,
                align: "right",
                render: (row) => (
                  <DualDollarValuePdf value={row.salary} />
                ),
              },
            ]}
          />

          <Text style={s.footnote}>
            Future pay is every salary dollar this plan projects, discounted back to today
            at the plan&apos;s inflation assumption.
          </Text>
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
