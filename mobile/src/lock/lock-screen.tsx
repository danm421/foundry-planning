import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";

export function LockScreen({ onUnlock }: { onUnlock: () => Promise<void> }) {
  useEffect(() => {
    void onUnlock(); // prompt Face ID immediately
  }, [onUnlock]);

  return (
    <View className="absolute inset-0 z-50 items-center justify-center bg-paper">
      <Text className="text-ink text-xl font-semibold">Foundry Planning</Text>
      <Text className="text-ink-3 mt-2">Locked</Text>
      <Pressable className="mt-8 bg-accent rounded-xl px-8 py-3.5" onPress={() => void onUnlock()}>
        <Text className="text-paper font-semibold">Unlock</Text>
      </Pressable>
    </View>
  );
}
