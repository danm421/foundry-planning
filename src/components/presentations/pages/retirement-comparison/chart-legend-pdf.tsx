import { View, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";

/** Shared swatch + label legend for the Retirement Comparison charts. */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
          <View style={{ width: 6, height: 6, backgroundColor: it.color, marginRight: 3 }} />
          <Text style={{ fontSize: 7, color: T.ink2 }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}
