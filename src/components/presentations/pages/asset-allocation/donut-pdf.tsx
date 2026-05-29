import { View, Svg, Path, Text } from "@react-pdf/renderer";
import type { DonutSpec } from "@/lib/presentations/charts/types";
import { segmentAngles, donutArcPath } from "@/lib/presentations/charts/donut-chart-spec";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

export function DonutPdf({ spec, title }: { spec: DonutSpec; title?: string }) {
  const cx = spec.size / 2;
  const cy = spec.size / 2;
  const ringWidth = (spec.size / 2) / (spec.rings.length + 0.6);
  return (
    <View>
      {title && (
        <Text style={{ fontSize: 9, color: PRESENTATION_THEME.ink2, textAlign: "center", marginBottom: 4 }}>{title}</Text>
      )}
      <Svg width={spec.size} height={spec.size}>
        {spec.rings.map((ring, ri) => {
          const rOuter = spec.size / 2 - ri * ringWidth;
          const rInner = rOuter - ringWidth * 0.9;
          const angles = segmentAngles(ring.segments.map((s) => s.value));
          return ring.segments.map((seg, i) => {
            const a = angles[i];
            if (!a) return null;
            return (
              <Path key={`${ri}-${seg.key}`} d={donutArcPath(cx, cy, rInner, rOuter, a.start, a.end)} fill={seg.color} />
            );
          });
        })}
      </Svg>
      <View style={{ marginTop: 6 }}>
        {spec.legend.map((l) => (
          <View key={l.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
            <View style={{ width: 7, height: 7, backgroundColor: l.color, marginRight: 5, borderRadius: 1 }} />
            <Text style={{ fontSize: 7.5, color: PRESENTATION_THEME.ink2, flex: 1 }}>{l.label}</Text>
            <Text style={{ fontSize: 7.5, color: PRESENTATION_THEME.ink3, fontFamily: "JetBrains Mono" }}>{`${Math.round(l.pct * 100)}%`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
