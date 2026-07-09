import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { LOCK_GRACE_MS, shouldLock } from "./lock-policy";

const ENABLED_KEY = "app_lock_enabled"; // "true" | "false"; missing = true (default ON per spec)

export function useAppLock() {
  const [enabled, setEnabledState] = useState(true);
  const [locked, setLocked] = useState(true); // assume locked until the flag loads
  const lastActiveAt = useRef<number | null>(null);
  const enabledRef = useRef(true);

  useEffect(() => {
    SecureStore.getItemAsync(ENABLED_KEY).then((v) => {
      const on = v !== "false";
      enabledRef.current = on;
      setEnabledState(on);
      setLocked(shouldLock({ enabled: on, lastActiveAt: null, now: Date.now(), graceMs: LOCK_GRACE_MS }));
    }).catch(() => {
      /* keychain unreadable — keep the fail-closed defaults (enabled + locked) */
    });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        lastActiveAt.current = Date.now();
      } else if (next === "active") {
        if (
          shouldLock({
            enabled: enabledRef.current,
            lastActiveAt: lastActiveAt.current,
            now: Date.now(),
            graceMs: LOCK_GRACE_MS,
          })
        ) {
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) {
      // No biometrics/passcode enrolled on this device — don't brick the app.
      setLocked(false);
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Foundry Planning",
    });
    if (result.success) setLocked(false);
  }, []);

  const setEnabled = useCallback(async (v: boolean) => {
    try {
      await SecureStore.setItemAsync(ENABLED_KEY, v ? "true" : "false");
    } catch {
      return; // write failed — keep prior state so UI and persisted flag never diverge
    }
    enabledRef.current = v;
    setEnabledState(v);
  }, []);

  return { locked, unlock, enabled, setEnabled };
}
