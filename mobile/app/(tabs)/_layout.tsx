import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { MeGate, useMe } from "@/auth/me-gate";
import { isSectionVisible } from "@/nav/sections";

export default function TabsLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  return (
    <MeGate>
      <PortalTabs />
    </MeGate>
  );
}

/**
 * Split out of TabsLayout so it renders *inside* MeGate and can read the
 * advisor's feature switches. `href: null` takes a screen out of the tab bar
 * while leaving the route addressable, which is what we want: the section is
 * gone from the bar, and anything that still reaches the route renders its own
 * switched-off notice.
 */
function PortalTabs() {
  const { features } = useMe();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#15171f", borderTopColor: "#2b2f3a" },
        tabBarActiveTintColor: "#4fd0bf",
        tabBarInactiveTintColor: "#848a98",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: "Accounts",
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: "Transactions",
          href: isSectionVisible("transactions", features) ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: "Budget",
          href: isSectionVisible("budget", features) ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
