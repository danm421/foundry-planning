import { Text, View } from "react-native";
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="py-16 items-center">
      <Text className="text-ink-2">{title}</Text>
      {hint ? <Text className="text-ink-4 mt-1">{hint}</Text> : null}
    </View>
  );
}
