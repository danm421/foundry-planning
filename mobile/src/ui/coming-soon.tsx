import { Text, View } from "react-native";

export function ComingSoon({ title }: { title: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-paper px-8">
      <Text className="text-ink text-lg font-semibold">{title}</Text>
      <Text className="text-ink-3 mt-2 text-center">
        Coming in the next build. It's already available on the web portal.
      </Text>
    </View>
  );
}
