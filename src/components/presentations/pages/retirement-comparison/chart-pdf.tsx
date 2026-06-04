import { View, Svg, G, Rect, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import type { OverlayBar } from "@/lib/presentations/pages/retirement-comparison/types";

const FLOOR = dataLight.blue;   // #2d61aa — common to both
const AHEAD = dataLight.green;  // #1f8d5f — scenario ahead
const BEHIND = dataLight.grey;  // #878d99 — base ahead

const SEGMENTS: Array<{ key: keyof Pick<OverlayBar, "floor" | "scenarioAhead" | "baseAhead">; label: string; color: string }> = [
  { key: "floor", label: "Common to both", color: FLOOR },
  { key: "scenarioAhead", label: "Scenario ahead", color: AHEAD },
  { key: "baseAhead", label: "Base ahead", color: BEHIND },
];

/** Stacked overlay bars — blue floor with green/grey caps. Width fits the
 *  content column of a portrait Letter page (~506pt; 500 leaves margin). */
export function OverlayBarsPdf({ bars, retirementYear }: { bars: OverlayBar[]; retirementYear: number }) {
  const width = 500;
  const height = 150;
  const leftPad = 6;
  const plotH = height - 22;
  const n = Math.max(1, bars.length);
  const slot = (width - leftPad) / n;
  const barWidth = Math.max(2, Math.min(14, slot * 0.7));
  const maxTotal = Math.max(1, ...bars.map((b) => b.floor + b.scenarioAhead + b.baseAhead));
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <View>
      <Svg width={width} height={height}>
        {bars.map((b, i) => {
          const x = leftPad + i * slot + (slot - barWidth) / 2;
          let yCursor = plotH;
          const isRet = b.year === retirementYear;
          return (
            <G key={b.year}>
              {SEGMENTS.map((seg) => {
                const value = b[seg.key];
                if (value <= 0) return null;
                const segH = (value / maxTotal) * plotH;
                yCursor -= segH;
                return <Rect key={seg.key} x={x} y={yCursor} width={barWidth} height={segH} fill={seg.color} />;
              })}
              {isRet ? <Rect x={x - 1} y={0} width={barWidth + 2} height={plotH} fill="none" stroke={T.ink} strokeWidth={0.75} /> : null}
              {i % labelEvery === 0 || isRet ? (
                <SvgText x={x + barWidth / 2} y={plotH + 12} textAnchor="middle" style={{ fontSize: 6, fill: isRet ? T.ink : T.ink2 }}>
                  {`'${String(b.year).slice(2)}`}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {SEGMENTS.map((seg) => (
          <View key={seg.key} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
            <View style={{ width: 6, height: 6, backgroundColor: seg.color, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{seg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
