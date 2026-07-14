import { Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import { useMe } from "@/auth/me-gate";
import { useAppLock } from "@/lock/use-app-lock";
import { usePushNotifications } from "@/push/use-push-notifications";
import { Row } from "@/ui/row";

const MORE_LINKS = [
  { label: "Investments", href: "/investments" },
  { label: "Recurrings", href: "/recurrings" },
  { label: "Profile", href: "/profile" },
  { label: "Privacy & sharing", href: "/privacy" },
] as const;

export default function More() {
  const me = useMe();
  const router = useRouter();
  const { signOut } = useAuth();
  const { enabled, setEnabled } = useAppLock();
  const { enabled: pushEnabled, setEnabled: setPushEnabled, unregister } = usePushNotifications();

  const handleSignOut = async () => {
    await unregister();
    await signOut();
  };

  return (
    <View className="flex-1 bg-paper px-4 pt-16">
      <Text className="text-ink text-2xl font-semibold mb-6">More</Text>

      <View className="bg-card border border-hair rounded-2xl px-4">
        {MORE_LINKS.map((link, i) => (
          <View
            key={link.href}
            className={i === MORE_LINKS.length - 1 ? "" : "border-b border-hair"}
          >
            <Row
              label={link.label}
              right={<Ionicons name="chevron-forward" size={20} color="#848a98" />}
              onPress={() => router.push(link.href)}
            />
          </View>
        ))}
      </View>

      <View className="bg-card border border-hair rounded-2xl px-4 mt-4">
        <View className="flex-row items-center justify-between py-3 border-b border-hair">
          <Text className="text-ink">Require Face ID</Text>
          <Switch value={enabled} onValueChange={(v) => void setEnabled(v)} />
        </View>
        <View className="flex-row items-center justify-between py-3">
          <Text className="text-ink">Push notifications</Text>
          <Switch value={pushEnabled} onValueChange={(v) => void setPushEnabled(v)} />
        </View>
      </View>

      <Pressable
        className="bg-card border border-hair rounded-2xl px-4 py-4 mt-4"
        onPress={() => void handleSignOut()}
      >
        <Text className="text-crit">Sign out</Text>
      </Pressable>

      <Text className="text-ink-4 mt-6 text-center">
        {me.client.email} · {me.firm.name}
      </Text>
    </View>
  );
}
