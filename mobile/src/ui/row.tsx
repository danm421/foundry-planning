import { Pressable, Text, View } from "react-native";

/** A tappable list row: left label (+ optional sublabel), right value (+ optional
 *  right sublabel). Mirrors the Home tile row idiom. */
export function Row({
  label, sublabel, value, valueSub, onPress, leading, right,
}: {
  label: string;
  sublabel?: string | null;
  value?: string;
  valueSub?: string | null;
  onPress?: () => void;
  leading?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const body = (
    <View className="flex-row items-center py-3">
      {leading ? <View className="mr-3">{leading}</View> : null}
      <View className="flex-1 pr-3">
        <Text className="text-ink" numberOfLines={1}>{label}</Text>
        {sublabel ? <Text className="text-ink-4 text-xs mt-0.5" numberOfLines={1}>{sublabel}</Text> : null}
      </View>
      {right ?? (
        value !== undefined ? (
          <View className="items-end">
            <Text className="text-ink" numberOfLines={1}>{value}</Text>
            {valueSub ? <Text className="text-ink-4 text-xs mt-0.5">{valueSub}</Text> : null}
          </View>
        ) : null
      )}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}
