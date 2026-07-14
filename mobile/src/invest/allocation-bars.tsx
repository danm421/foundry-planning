// mobile/src/invest/allocation-bars.tsx
//
// Pure View/Text allocation breakdown (no chart lib). One row per item:
// name, a bar sized relative to the largest weight in the list, and a
// right-aligned percent label. Weights are fractions in [0, 1].

import { Text, View } from "react-native";

export function AllocationBars({ items }: { items: { name: string; weight: number }[] }) {
  const maxWeight = Math.max(...items.map((i) => i.weight), 1e-9);
  return (
    <View>
      {items.map((item, i) => (
        <View key={`${item.name}-${i}`} className={i === items.length - 1 ? "" : "mb-3"}>
          <View className="flex-row justify-between mb-1">
            <Text className="text-ink-2 flex-1 mr-2" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="text-ink-3">{Math.round(item.weight * 100)}%</Text>
          </View>
          <View className="h-2 bg-card-2 rounded-full overflow-hidden">
            <View
              className="h-2 bg-accent rounded-full"
              style={{ width: `${(item.weight / maxWeight) * 100}%` }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
