import { View, Svg, G, Line, Circle, Rect, Path, Text as SvgText, Text } from "@react-pdf/renderer";
import { scaleLinear } from "d3-scale";
import type { ScatterSpec, ScatterPoint } from "@/lib/presentations/charts/types";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";

function Marker({ x, y, color, style }: { x: number; y: number; color: string; style: ScatterPoint["pointStyle"] }) {
  const r = 3;
  if (style === "rect") return <Rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={color} />;
  if (style === "triangle") return <Path d={`M ${x} ${y - r} L ${x + r} ${y + r} L ${x - r} ${y + r} Z`} fill={color} />;
  if (style === "rectRot") return <Path d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`} fill={color} />;
  if (style === "star") {
    const sr = 3.5;
    const ir = sr * 0.35;
    return <Path d={`M ${x} ${y - sr} L ${x + ir} ${y - ir} L ${x + sr} ${y} L ${x + ir} ${y + ir} L ${x} ${y + sr} L ${x - ir} ${y + ir} L ${x - sr} ${y} L ${x - ir} ${y - ir} Z`} fill={color} />;
  }
  return <Circle cx={x} cy={y} r={r} fill={color} />;
}

export function ScatterPdf({ spec }: { spec: ScatterSpec }) {
  const innerW = spec.width - spec.margin.left - spec.margin.right;
  const innerH = spec.height - spec.margin.top - spec.margin.bottom;
  const x = scaleLinear().domain(spec.xAxis.domain).range([0, innerW]);
  const y = scaleLinear().domain(spec.yAxis.domain).range([innerH, 0]);
  return (
    <View>
      <Svg width={spec.width} height={spec.height}>
        <G transform={`translate(${spec.margin.left}, ${spec.margin.top})`}>
          {spec.yAxis.ticks.map((t) => (
            <G key={`y${t}`}>
              <Line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={spec.gridlineColor} strokeWidth={0.5} />
              <SvgText x={-6} y={y(t) + 3} style={{ fontFamily: "JetBrains Mono", fontSize: 7, fill: T.ink3 }}>{spec.yAxis.labelFormat(t)}</SvgText>
            </G>
          ))}
          {spec.xAxis.ticks.map((t) => (
            <G key={`x${t}`}>
              <Line x1={x(t)} x2={x(t)} y1={0} y2={innerH} stroke={spec.gridlineColor} strokeWidth={0.5} />
              <SvgText x={x(t)} y={innerH + 12} style={{ fontFamily: "JetBrains Mono", fontSize: 7, fill: T.ink3 }}>{spec.xAxis.labelFormat(t)}</SvgText>
            </G>
          ))}
          {/* x-axis title */}
          <SvgText x={innerW / 2} y={innerH + 30} style={{ fontFamily: "Inter", fontSize: 8, fill: T.ink2, textAnchor: "middle" }}>{spec.xAxis.title}</SvgText>
          {/* y-axis title — rotated -90° around its anchor point */}
          <G transform={`rotate(-90, -38, ${innerH / 2})`}>
            <SvgText x={-38} y={innerH / 2} style={{ fontFamily: "Inter", fontSize: 8, fill: T.ink2, textAnchor: "middle" }}>{spec.yAxis.title}</SvgText>
          </G>
          {spec.points.map((p) => (
            <Marker key={p.key} x={x(p.x)} y={y(p.y)} color={p.color} style={p.pointStyle} />
          ))}
        </G>
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {spec.legend.items.map((i) => (
          <View key={i.label} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
            <View style={{ width: 6, height: 6, backgroundColor: i.color, marginRight: 4, borderRadius: 1 }} />
            <Text style={{ fontSize: 7.5, color: T.ink2 }}>{i.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
