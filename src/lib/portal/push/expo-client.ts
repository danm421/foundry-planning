import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import type { PushMessage } from "./messages";

// accessToken is optional for the Expo push service; wire EXPO_ACCESS_TOKEN
// when available (non-blocking).
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

export type PushSendResult = { sentCount: number; invalidTokens: string[] };

export async function sendExpoPush(
  tokens: string[],
  message: PushMessage,
): Promise<PushSendResult> {
  // `Expo.isExpoPushToken` is typed as a type predicate over a plain `string`
  // alias (`ExpoPushToken = string`), so negating it in a `.filter()` callback
  // would make TS narrow the result to `never[]`. Wrap it in `Boolean(...)` to
  // keep both arrays as plain `string[]`.
  const isValidToken = (t: string) => Boolean(Expo.isExpoPushToken(t));
  const valid = tokens.filter(isValidToken);
  const invalid = tokens.filter((t) => !isValidToken(t));
  if (valid.length === 0) return { sentCount: 0, invalidTokens: invalid };

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data,
    sound: "default",
  }));

  const tickets: ExpoPushTicket[] = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
  }

  // Tickets are positional to `valid` (chunking preserves order).
  tickets.forEach((ticket, i) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      invalid.push(valid[i]);
    }
  });

  return { sentCount: valid.length, invalidTokens: invalid };
}
