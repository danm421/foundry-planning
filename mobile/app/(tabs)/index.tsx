import { Text, View } from "react-native";
import { useMe } from "@/auth/me-gate";

export default function Home() {
  const me = useMe();
  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <Text className="text-ink text-lg">Hi {me.client.displayName || "there"}</Text>
      <Text className="text-ink-3 mt-1">{me.firm.name}</Text>
    </View>
  );
}
