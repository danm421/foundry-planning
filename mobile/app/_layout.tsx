import "../global.css";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { Slot } from "expo-router";
import { ApiProvider } from "@/api/context";
import { LockScreen } from "@/lock/lock-screen";
import { useAppLock } from "@/lock/use-app-lock";

function AppLockGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { locked, unlock } = useAppLock();
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
          <Slot />
        </AppLockGate>
      </ApiProvider>
    </ClerkProvider>
  );
}
