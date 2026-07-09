import { Pressable, Switch, Text, View } from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import { useMe } from "@/auth/me-gate";
import { useAppLock } from "@/lock/use-app-lock";

const COMING_NEXT = ["Investments", "Recurrings", "Profile", "Settings"];

export default function More() {
  const me = useMe();
  const { signOut } = useAuth();
  const { enabled, setEnabled } = useAppLock();

  return (
    <View className="flex-1 bg-paper px-4 pt-16">
      <Text className="text-ink text-2xl font-semibold mb-6">More</Text>

      <View className="bg-card border border-hair rounded-2xl px-4">
        {COMING_NEXT.map((label, i) => (
          <View
            key={label}
            className={`py-4 ${i === COMING_NEXT.length - 1 ? "" : "border-b border-hair"}`}
          >
            <Text className="text-ink-4">{label} — next build</Text>
          </View>
        ))}
      </View>

      <View className="bg-card border border-hair rounded-2xl px-4 mt-4 flex-row items-center justify-between py-3">
        <Text className="text-ink">Require Face ID</Text>
        <Switch value={enabled} onValueChange={(v) => void setEnabled(v)} />
      </View>

      <Pressable
        className="bg-card border border-hair rounded-2xl px-4 py-4 mt-4"
        onPress={() => void signOut()}
      >
        <Text className="text-crit">Sign out</Text>
      </Pressable>

      <Text className="text-ink-4 mt-6 text-center">
        {me.client.email} · {me.firm.name}
      </Text>
    </View>
  );
}
