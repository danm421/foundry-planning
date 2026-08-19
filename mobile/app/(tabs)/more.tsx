import { Pressable, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import { useMe } from "@/auth/me-gate";
import { useAppLock } from "@/lock/use-app-lock";
import { usePushNotifications } from "@/push/use-push-notifications";
import { Row } from "@/ui/row";
import { visibleMoreLinks } from "@/nav/sections";

export default function More() {
  const me = useMe();
  const router = useRouter();
  const { signOut } = useAuth();
  const { enabled, setEnabled } = useAppLock();
  const { enabled: pushEnabled, setEnabled: setPushEnabled, unregister } = usePushNotifications();
  // A section the advisor switched off 403s at the API, so listing it here
  // would only lead somewhere broken.
  const links = visibleMoreLinks(me.features);

  const handleSignOut = async () => {
    await unregister();
    await signOut();
  };

  return (
    <View className="flex-1 bg-paper px-4 pt-16">
      <Text className="text-ink text-2xl font-semibold mb-6">More</Text>

      {me.intakePending ? (
        <View className="bg-card border border-hair rounded-2xl px-4 mb-4">
          <Row
            label="Complete your intake"
            right={<Ionicons name="chevron-forward" size={20} color="#848a98" />}
            onPress={() => router.push("/intake")}
          />
        </View>
      ) : null}

      <View className="bg-card border border-hair rounded-2xl px-4">
        {links.map((link, i) => (
          <View
            key={link.href}
            className={i === links.length - 1 ? "" : "border-b border-hair"}
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
