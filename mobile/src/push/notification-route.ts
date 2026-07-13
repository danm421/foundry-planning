// mobile/src/push/notification-route.ts
//
// Pure: given an expo-notifications content.data payload, return the
// expo-router path to deep-link to (or null). No react-native imports.
export function routeForNotificationData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const route = (data as { route?: unknown }).route;
  return typeof route === "string" && route.length > 0 ? route : null;
}
