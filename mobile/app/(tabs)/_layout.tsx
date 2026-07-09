import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import { MeGate } from "@/auth/me-gate";

export default function TabsLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  return (
    <MeGate>
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
            tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="budget"
          options={{
            title: "Budget",
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
    </MeGate>
  );
}
