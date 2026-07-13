import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { useApi } from "@/api/context";
import { deletePushToken, registerPushToken } from "@/api/portal";

const ENABLED_KEY = "push_enabled"; // "true" | "false"; missing = true (default ON)

function platform(): "ios" | "android" {
  return Platform.OS === "android" ? "android" : "ios";
}

async function getExpoToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't receive push
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null; // set at EAS build time
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

export function usePushNotifications() {
  const api = useApi();
  const [enabled, setEnabledState] = useState(true);
  const tokenRef = useRef<string | null>(null);
  // In-flight `register()` promise, if any. `unregister()` and the disable
  // path in `setEnabled` must await this before consulting `tokenRef` —
  // otherwise a registration that's still mid-flight (permission check →
  // getExpoPushTokenAsync → POST) races sign-out/toggle-off and the token
  // never gets deleted server-side.
  const registrationRef = useRef<Promise<void> | null>(null);

  const register = useCallback(async () => {
    try {
      const perm = await Notifications.requestPermissionsAsync();
      if (perm.status !== "granted") return;
      const token = await getExpoToken();
      if (!token) return;
      tokenRef.current = token;
      await registerPushToken(api, { expoPushToken: token, platform: platform(), enabled: true });
    } catch {
      // offline device / backend error — swallow, matching setEnabled's disable-branch pattern
    }
  }, [api]);

  const startRegistration = useCallback(() => {
    const p = register();
    registrationRef.current = p;
    return p;
  }, [register]);

  useEffect(() => {
    SecureStore.getItemAsync(ENABLED_KEY)
      .then((v) => {
        const on = v !== "false";
        setEnabledState(on);
        if (on) void startRegistration();
      })
      .catch(() => {});
  }, [startRegistration]);

  const setEnabled = useCallback(
    async (v: boolean) => {
      try {
        await SecureStore.setItemAsync(ENABLED_KEY, v ? "true" : "false");
      } catch {
        return;
      }
      setEnabledState(v);
      if (v) {
        await startRegistration();
      } else {
        if (registrationRef.current) await registrationRef.current;
        if (tokenRef.current) {
          await registerPushToken(api, {
            expoPushToken: tokenRef.current,
            platform: platform(),
            enabled: false,
          }).catch(() => {});
        }
      }
    },
    [api, startRegistration],
  );

  const unregister = useCallback(async () => {
    if (registrationRef.current) await registrationRef.current;
    if (tokenRef.current) await deletePushToken(api, tokenRef.current).catch(() => {});
  }, [api]);

  return { enabled, setEnabled, unregister };
}
