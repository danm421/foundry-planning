import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { useApi } from "@/api/context";
import { startIntakeSession } from "@/api/portal";
import { buildIntakeEnterUrl } from "@/intake/enter-url";
import { isSameOriginUrl } from "@/intake/same-origin";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type State = { kind: "loading" } | { kind: "ready"; uri: string } | { kind: "error" };

export default function Intake() {
  const api = useApi();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const mint = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { ticket } = await startIntakeSession(api);
      setState({ kind: "ready", uri: buildIntakeEnterUrl(BASE, ticket) });
    } catch {
      setState({ kind: "error" });
    }
  }, [api]);

  useEffect(() => {
    void mint();
  }, [mint]);

  return (
    <View className="flex-1 bg-paper">
      <View className="flex-row items-center justify-between px-4 pt-16 pb-3 border-b border-hair">
        <Text className="text-ink text-lg font-semibold">Intake</Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text className="text-ink-2">Done</Text>
        </Pressable>
      </View>

      {state.kind === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : state.kind === "error" ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-ink text-center">Couldn't open your intake form.</Text>
          <Pressable
            className="mt-6 bg-card border border-hair rounded-xl px-6 py-3"
            onPress={() => void mint()}
          >
            <Text className="text-ink">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          source={{ uri: state.uri }}
          sharedCookiesEnabled
          startInLoadingState
          renderLoading={() => (
            <View className="flex-1 items-center justify-center bg-paper">
              <ActivityIndicator />
            </View>
          )}
          onShouldStartLoadWithRequest={(req) => {
            if (isSameOriginUrl(req.url, BASE)) return true;
            void Linking.openURL(req.url).catch(() => {});
            return false;
          }}
        />
      )}
    </View>
  );
}
