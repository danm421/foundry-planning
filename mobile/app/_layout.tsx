import "../global.css";
import { useEffect } from "react";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { ApiProvider } from "@/api/context";
import { LockScreen } from "@/lock/lock-screen";
import { useAppLock } from "@/lock/use-app-lock";
import { routeForNotificationData } from "@/push/notification-route";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function useNotificationRouting() {
  const router = useRouter();
  useEffect(() => {
    // Cold-start: app was launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => {
        const route = resp && routeForNotificationData(resp.notification.request.content.data);
        if (route) router.push(route as never);
      })
      .catch(() => {});
    // Warm: tapped while running.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const route = routeForNotificationData(resp.notification.request.content.data);
      if (route) router.push(route as never);
    });
    return () => sub.remove();
  }, [router]);
}

function AppLockGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { locked, unlock } = useAppLock();
  useNotificationRouting();
  return (
    <>
      {children}
      {isSignedIn && locked ? <LockScreen onUnlock={unlock} /> : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <ApiProvider>
        <AppLockGate>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen
              name="account/[id]"
              options={{ presentation: "modal", headerShown: false }}
            />
            <Stack.Screen
              name="category/[id]"
              options={{ presentation: "modal", headerShown: false }}
            />
            <Stack.Screen
              name="plaid/[itemId]"
              options={{ presentation: "modal", headerShown: false }}
            />
            <Stack.Screen
              name="investment/[id]"
              options={{ presentation: "modal", headerShown: false }}
            />
            <Stack.Screen name="investments" options={{ headerShown: false }} />
            <Stack.Screen name="recurrings" options={{ headerShown: false }} />
            <Stack.Screen name="profile" options={{ headerShown: false }} />
            <Stack.Screen name="privacy" options={{ headerShown: false }} />
            <Stack.Screen name="intake" options={{ headerShown: false }} />
            <Stack.Screen
              name="recurring/[id]"
              options={{ presentation: "modal", headerShown: false }}
            />
          </Stack>
        </AppLockGate>
      </ApiProvider>
    </ClerkProvider>
  );
}
