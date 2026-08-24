import { Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { DetailTablePdf } from "./detail-table-pdf";
import { DualDollarValuePdf, dualDollarCaption } from "./dual-dollar-value-pdf";
import type { DollarPair } from "@/lib/presentations/real-dollars";

export interface GroupedDetailGroup {
  age: number;
  year: number;
  bars: { value: DollarPair }[];
}

const s = StyleSheet.create({
  ageText: { fontSize: 7, color: T.ink },
});

/**
 * The detail figures behind a `GroupedBarChartPdf`: ONE ROW PER AGE, one column
 * per series — the chart's own shape, so a reader can drop from a bar straight
 * to its number.
 *
 * Shared because the ladder ("What Saving More Is Worth") and waiting ("The Cost
 * of Waiting") sheets sit in one deck and must read alike. They previously held
 * this table twice, differing only in where the column labels came from, with a
 * comment carrying the invariant — so the next spacing tweak would have landed
 * on one sheet.
 *
 * `seriesHeaders[i]` names `group.bars[i]`: the two arrays are index-aligned by
 * the view-models, which build the bars from the series in order.
 */
export function GroupedDetailTablePdf({
  groups,
  seriesHeaders,
  quantity,
}: {
  groups: GroupedDetailGroup[];
  seriesHeaders: string[];
  /** What the cells hold, e.g. "Portfolio at each age". The units are added. */
  quantity: string;
}) {
  return (
    <DetailTablePdf
      rows={groups}
      rowKey={(group) => String(group.age)}
      rowPaddingVertical={2}
      caption={dualDollarCaption(quantity)}
      columns={[
        {
          header: "Age / year",
          flex: 0.9,
          render: (group) => (
            <Text style={s.ageText}>{`${group.age} · ${group.year}`}</Text>
          ),
        },
        ...seriesHeaders.map((header, index) => ({
          header,
          flex: 1,
          align: "right" as const,
          render: (group: GroupedDetailGroup) => {
            const bar = group.bars[index];
            return bar == null ? null : <DualDollarValuePdf value={bar.value} />;
          },
        })),
      ]}
    />
  );
}
