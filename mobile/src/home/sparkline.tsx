import { View } from "react-native";
import { CartesianChart, Line } from "victory-native";
import type { TrendPoint } from "@contracts";

export function Sparkline({ series, height = 48 }: { series: TrendPoint[]; height?: number }) {
  const data = series.map((p, i) => ({ i, v: p.netWorth }));
  if (data.length < 2) return <View style={{ height }} />;
  return (
    <View style={{ height }} pointerEvents="none">
      <CartesianChart data={data} xKey="i" yKeys={["v"]}>
        {({ points }) => <Line points={points.v} color="#4fd0bf" strokeWidth={2} />}
      </CartesianChart>
    </View>
  );
}
