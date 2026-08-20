import { View, Svg, Rect, Text as SvgText } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { fmtAxisUsd, MONO } from "../retirement-comparison/chart-axis";

export interface HumanCapitalBar {
  label: string;
  value: number;
  fill: string;
}

/**
 * Two HORIZONTAL bars.
 *
 * Vertical ones would be two 22pt slivers adrift in a 505pt plot — the shared
 * grouped-bar chart caps a bar at that width — and the two magnitudes here
 * routinely differ by 20×, so a horizontal layout is also the only one that
 * gives the short bar somewhere to put its label.
 */
export function HumanCapitalChartPdf({
  bars,
  width = 505,
}: {
  bars: HumanCapitalBar[];
  width?: number;
}) {
  if (bars.length === 0) return null;

  const rowH = 52;
  const barH = 22;
  const padL = 2;
  const height = bars.length * rowH;
  const maxV = Math.max(1, ...bars.map((b) => b.value));
  // Room at the right for the value label, which is printed OUTSIDE the bar so
  // it stays legible on a short one.
  const plotW = width - padL - 78;
  const widthOf = (v: number) => Math.max(1, (v / maxV) * plotW);

  // Three passes rather than one group per bar: react-pdf's SVG renderer paints
  // in document order, so a value label emitted between two bars can be
  // overpainted by the next Rect.
  return (
    <View>
      <Svg width={width} height={height}>
        {bars.map((b, i) => (
          <SvgText
            key={b.label}
            x={padL}
            y={i * rowH + 12}
            style={{ fontSize: 7.5, fill: T.ink2 }}
          >
            {b.label}
          </SvgText>
        ))}
        {bars.map((b, i) => (
          <Rect
            key={b.label}
            x={padL}
            y={i * rowH + 18}
            width={widthOf(b.value)}
            height={barH}
            fill={b.fill}
          />
        ))}
        {bars.map((b, i) => (
          <SvgText
            key={b.label}
            x={padL + widthOf(b.value) + 6}
            y={i * rowH + 18 + barH - 6}
            style={{ fontSize: 10, fill: T.ink, fontFamily: MONO }}
          >
            {fmtAxisUsd(b.value)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
