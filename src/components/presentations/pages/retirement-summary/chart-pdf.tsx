import { View, Svg, G, Rect, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { fmtUsd } from "@/lib/presentations/pages/retirement-summary/aggregate";
import type { PortfolioBar } from "@/lib/presentations/pages/retirement-summary/aggregate";

const PORTFOLIO_SEGMENTS: Array<{ key: keyof PortfolioBar; label: string; color: string }> = [
  { key: "cash", label: "Cash", color: T.steel },
  { key: "taxable", label: "Taxable", color: T.accent },
  { key: "retirement", label: "Retirement", color: T.good },
];

/** Stacked portfolio bars over time. Width matches the panel's available
 *  content width on a portrait Letter page (612 − 86 page padding − 20 panel
 *  padding ≈ 506pt; 500 leaves a small safety margin). Markers at the
 *  retirement year. */
export function PortfolioBarsPdf({ bars, retirementYear }: { bars: PortfolioBar[]; retirementYear: number }) {
  const width = 500;
  const height = 150;
  const leftPad = 6;
  const plotH = height - 22;
  const n = Math.max(1, bars.length);
  const slot = (width - leftPad) / n;
  const barWidth = Math.max(2, Math.min(14, slot * 0.7));
  const maxTotal = Math.max(1, ...bars.map((b) => b.total));
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
              {PORTFOLIO_SEGMENTS.map((seg) => {
                const value = b[seg.key] as number;
                if (value <= 0) return null;
                const segH = (value / maxTotal) * plotH;
                yCursor -= segH;
                return <Rect key={seg.key as string} x={x} y={yCursor} width={barWidth} height={segH} fill={seg.color} />;
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
        {PORTFOLIO_SEGMENTS.map((seg) => (
          <View key={seg.key as string} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
            <View style={{ width: 6, height: 6, backgroundColor: seg.color, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{seg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface SplitSegment { label: string; value: number; color: string; }

/** Reusable 100% horizontal split bar + value table. Used for assets-by-type
 *  and assets-by-tax-type. Mirrors the composition bar in tax-summary page-pdf. */
export function SplitBarPdf({ segments }: { segments: SplitSegment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <View>
      <View style={{ flexDirection: "row", height: 14, borderRadius: 2, overflow: "hidden", marginTop: 4, marginBottom: 4 }}>
        {total > 0
          ? segments.map((seg) => {
              const pct = (seg.value / total) * 100;
              if (pct <= 0) return null;
              return <View key={seg.label} style={{ width: `${pct}%`, backgroundColor: seg.color }} />;
            })
          : <View style={{ width: "100%", backgroundColor: T.hair }} />}
      </View>
      {segments.map((seg) => {
        const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
        return (
          <View key={seg.label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <View style={{ width: 6, height: 6, marginRight: 4, backgroundColor: seg.color }} />
              <Text style={{ fontSize: 8, color: T.ink }}>{seg.label}</Text>
            </View>
            <Text style={{ fontSize: 8, color: T.ink2, width: 32, textAlign: "right" }}>{`${pct}%`}</Text>
            <Text style={{ fontSize: 9, fontWeight: 700, color: T.ink, width: 52, textAlign: "right" }}>{fmtUsd(seg.value)}</Text>
          </View>
        );
      })}
    </View>
  );
}
