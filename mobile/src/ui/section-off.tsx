import { Text, View } from "react-native";

/**
 * A section the advisor has switched off for this client. The API 403s
 * everything behind it (`requirePortalFeature`) and the web portal drops the
 * rail entry outright — this is what the phone shows for anything that still
 * reaches the route: a deep link, a push notification, or a build still
 * holding switches from before the advisor flipped one.
 *
 * `reason` is the server's own wording ("Your advisor has not enabled
 * Investments for this portal"), carried through the 403 body. It falls back
 * to a generic line rather than showing a raw error string, and deliberately
 * never offers a retry — retrying can only 403 again.
 */
export function SectionOff({ title, reason }: { title: string; reason?: string | null }) {
  const explanation =
    reason && reason !== "forbidden"
      ? reason
      : "Your advisor hasn't turned this on for your portal.";
  return (
    <View className="flex-1 items-center justify-center bg-paper px-8 py-24">
      <Text className="text-ink text-lg font-semibold text-center">{title}</Text>
      <Text className="text-ink-3 mt-2 text-center">{explanation}</Text>
      <Text className="text-ink-4 mt-2 text-center">
        Ask them if you'd like access.
      </Text>
    </View>
  );
}
