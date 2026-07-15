import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

/** Home prompt shown when the client has an unsubmitted prefilled intake form.
 *  Dismiss is per-session (handled by the caller's state). */
export function IntakeBanner({ onDismiss }: { onDismiss: () => void }) {
  const router = useRouter();
  return (
    <View className="bg-card border border-hair rounded-2xl px-4 py-4 mb-4 flex-row items-center">
      <Ionicons name="document-text-outline" size={22} color="#848a98" />
      <Pressable className="flex-1 ml-3" onPress={() => router.push("/intake")}>
        <Text className="text-ink font-semibold">Complete your intake</Text>
        <Text className="text-ink-4 text-xs mt-0.5">Your advisor needs a few details.</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close" size={20} color="#848a98" />
      </Pressable>
    </View>
  );
}
