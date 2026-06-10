import { View, Svg, G, Rect, Line, Text as SvgText } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import { niceAxis, fmtAxisUsd, MONO } from "./chart-axis";
import { ChartLegend } from "./chart-legend-pdf";
import type { OverlayBar } from "@/lib/presentations/pages/retirement-comparison/types";

const FLOOR = dataLight.blue;   // #2d61aa — common to both
const AHEAD = dataLight.green;  // #1f8d5f — scenario ahead
const BEHIND = dataLight.grey;  // #878d99 — base ahead

const SEGMENTS: Array<{ key: keyof Pick<OverlayBar, "floor" | "scenarioAhead" | "baseAhead">; label: string; color: string }> = [
  { key: "floor", label: "Common to both", color: FLOOR },
  { key: "scenarioAhead", label: "Scenario ahead", color: AHEAD },
  { key: "baseAhead", label: "Base ahead", color: BEHIND },
];

/** Stacked overlay bars with a dollar y-axis, an end-of-plan total annotation,
 *  and a dashed retirement marker. Width fits the content column of a portrait
 *  Letter page (~510pt). */
export function OverlayBarsPdf({ bars, retirementYear }: { bars: OverlayBar[]; retirementYear: number }) {
  const width = 500;
  const height = 174;
  const axisW = 34;
  const plotTop = 13;
  const plotBottom = height - 15;
  const plotH = plotBottom - plotTop;
  const n = Math.max(1, bars.length);
  const slot = (width - axisW) / n;
  const barWidth = Math.max(2, Math.min(13, slot * 0.72));

  const totals = bars.map((b) => b.floor + b.scenarioAhead + b.baseAhead);
  const maxTotal = Math.max(1, ...totals);
  const { axisMax, ticks } = niceAxis(maxTotal, 4);
  const y = (v: number) => plotBottom - (v / axisMax) * plotH;

  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const presentSegs = SEGMENTS.filter((seg) => bars.some((b) => b[seg.key] > 0));
  const lastIdx = bars.length - 1;
  const retIdx = bars.findIndex((b) => b.year === retirementYear);

  return (
    <View>
      <Svg width={width} height={height}>
        {/* gridlines + dollar axis */}
        {ticks.map((t) => (
          <G key={t}>
            <Line x1={axisW} y1={y(t)} x2={width} y2={y(t)} stroke={T.hair} strokeWidth={0.5} />
            <SvgText x={axisW - 4} y={y(t) + 2} textAnchor="end" style={{ fontSize: 6, fill: T.ink3, fontFamily: MONO }}>
              {fmtAxisUsd(t)}
            </SvgText>
          </G>
        ))}

        {/* bars */}
        {bars.map((b, i) => {
          const x = axisW + i * slot + (slot - barWidth) / 2;
          let yCursor = plotBottom;
          const isRet = i === retIdx;
          return (
            <G key={b.year}>
              {SEGMENTS.map((seg) => {
                const v = b[seg.key];
                if (v <= 0) return null;
                const h = (v / axisMax) * plotH;
                yCursor -= h;
                return <Rect key={seg.key} x={x} y={yCursor} width={barWidth} height={h} fill={seg.color} />;
              })}
              {i === lastIdx ? (
                <SvgText x={Math.min(width, x + barWidth + 1)} y={y(totals[i]) - 3} textAnchor="end" style={{ fontSize: 7.5, fontWeight: 600, fill: T.ink, fontFamily: MONO }}>
                  {fmtAxisUsd(totals[i])}
                </SvgText>
              ) : null}
              {i % labelEvery === 0 || isRet ? (
                <SvgText x={x + barWidth / 2} y={plotBottom + 10} textAnchor="middle" style={{ fontSize: 6, fill: isRet ? T.ink : T.ink3, fontWeight: isRet ? 600 : 400, fontFamily: MONO }}>
                  {`'${String(b.year).slice(2)}`}
                </SvgText>
              ) : null}
            </G>
          );
        })}

        {/* retirement marker */}
        {retIdx >= 0 ? (
          <G>
            <Line
              x1={axisW + retIdx * slot + slot / 2}
              y1={plotTop - 3}
              x2={axisW + retIdx * slot + slot / 2}
              y2={plotBottom}
              stroke={T.ink3}
              strokeWidth={0.6}
              strokeDasharray="2 2"
            />
            <SvgText x={axisW + retIdx * slot + slot / 2} y={plotTop - 5} textAnchor="middle" style={{ fontSize: 6.5, fill: T.ink2, fontWeight: 600 }}>
              {`Retirement '${String(retirementYear).slice(2)}`}
            </SvgText>
          </G>
        ) : null}
      </Svg>

      <ChartLegend items={presentSegs.map((seg) => ({ label: seg.label, color: seg.color }))} />
    </View>
  );
}
