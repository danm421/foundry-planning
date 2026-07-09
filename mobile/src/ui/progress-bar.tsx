import { View } from "react-native";
/** pct 0..1; over-budget bars render crit. */
export function ProgressBar({ pct, over = false }: { pct: number; over?: boolean }) {
  const w = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <View className="h-2 bg-card-2 rounded-full overflow-hidden">
      <View className={over ? "h-2 bg-crit" : "h-2 bg-accent"} style={{ width: `${w}%` }} />
    </View>
  );
}
