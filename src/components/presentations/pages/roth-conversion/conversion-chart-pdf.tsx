import { View, Svg, G, Rect, Line, Text as SvgText } from "@react-pdf/renderer";
import { dataLight } from "@/brand";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { bandLabelIndices } from "@/lib/presentations/charts/axis";
import { fmtAxisUsd, MONO } from "../retirement-comparison/chart-axis";
import { ChartLegend } from "../retirement-comparison/chart-legend-pdf";
import type { RothConversionYearRow } from "@/lib/presentations/pages/roth-conversion/types";

export const CONVERTED_FILL = dataLight.blue;
export const TAX_FILL = dataLight.orange;

/** Above this many bars the per-bar amounts collide; the table on the next
 *  sheet carries every figure. */
const MAX_VALUE_LABELS = 10;

/**
 * One bar per conversion year: the amount converted, with the extra tax that
 * year drawn inside it from the baseline — "of each dollar moved, this much went
 * to tax". The tax is not a slice OF the conversion in accounting terms, but it
 * is the cost of it, and set against it is how a client reads it.
 */
export function ConversionChartPdf({
  rows,
  width,
  height = 170,
}: {
  rows: RothConversionYearRow[];
  width: number;
  height?: number;
}) {
  if (rows.length === 0) return null;
  const padT = 12, padB = 16;
  const plotH = height - padT - padB;
  const baseY = padT + plotH;
  const maxY = Math.max(1, ...rows.map((r) => Math.max(r.converted, r.extraTax)));
  const slot = width / rows.length;
  const barW = Math.max(3, Math.min(34, slot * 0.62));
  const labelValues = rows.length <= MAX_VALUE_LABELS;
  const labelled = new Set(
    bandLabelIndices(rows.length, {
      every: Math.max(1, Math.ceil(rows.length / 10)),
      minGap: Math.ceil(22 / slot),
      pinned: [0, rows.length - 1],
    }),
  );

  return (
    <View>
      <Svg width={width} height={height}>
        {rows.map((r, i) => {
          const x = i * slot + (slot - barW) / 2;
          const h = Math.max(0.5, (r.converted / maxY) * plotH);
          const taxH = Math.max(0, (Math.max(0, r.extraTax) / maxY) * plotH);
          return (
            <G key={r.year}>
              <Rect x={x} y={baseY - h} width={barW} height={h} fill={CONVERTED_FILL} />
              {taxH > 0 ? <Rect x={x} y={baseY - taxH} width={barW} height={taxH} fill={TAX_FILL} /> : null}
              {labelValues ? (
                <SvgText
                  x={x + barW / 2}
                  y={baseY - h - 3}
                  textAnchor="middle"
                  style={{ fontSize: 6, fill: T.ink2, fontFamily: MONO }}
                >
                  {fmtAxisUsd(r.converted)}
                </SvgText>
              ) : null}
              {labelled.has(i) ? (
                <SvgText
                  x={x + barW / 2}
                  y={baseY + 11}
                  textAnchor="middle"
                  style={{ fontSize: 7, fill: T.ink2, fontFamily: MONO }}
                >
                  {String(r.year)}
                </SvgText>
              ) : null}
            </G>
          );
        })}
        <Line x1={0} y1={baseY} x2={width} y2={baseY} stroke={T.hair2} strokeWidth={0.75} />
      </Svg>
      <ChartLegend
        items={[
          { label: "Amount converted", color: CONVERTED_FILL },
          { label: "Extra tax that year", color: TAX_FILL },
        ]}
      />
    </View>
  );
}
