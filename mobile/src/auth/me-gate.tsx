import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import type { PortalMeDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchMe, NotPortalClientError } from "@/api/portal";

const MeContext = createContext<PortalMeDTO | null>(null);

export function useMe(): PortalMeDTO {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside MeGate");
  return me;
}

export function MeGate({ children }: { children: ReactNode }) {
  const api = useApi();
  const { signOut } = useAuth();
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; me: PortalMeDTO } | { kind: "not-client" } | { kind: "error" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchMe(api)
      .then((me) => !cancelled && setState({ kind: "ready", me }))
      .catch((e) =>
        !cancelled &&
        setState({ kind: e instanceof NotPortalClientError ? "not-client" : "error" }),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (state.kind === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator />
      </View>
    );
  }
  if (state.kind === "not-client") {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <Text className="text-ink text-lg font-semibold text-center">
          This app is for portal clients
        </Text>
        <Text className="text-ink-3 mt-2 text-center">
          Advisors: use the web app, where you can preview any client's portal.
        </Text>
        <Pressable className="mt-6 bg-card border border-hair rounded-xl px-6 py-3" onPress={() => signOut()}>
          <Text className="text-ink">Sign out</Text>
        </Pressable>
      </View>
    );
  }
  if (state.kind === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <Text className="text-ink text-center">Couldn't reach the server.</Text>
        <Text className="text-ink-3 mt-2 text-center">Check your connection and reopen the app.</Text>
      </View>
    );
  }
  return <MeContext.Provider value={state.me}>{children}</MeContext.Provider>;
}
