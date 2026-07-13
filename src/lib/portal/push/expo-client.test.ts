import { describe, it, expect, beforeEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("expo-server-sdk", () => {
  class Expo {
    static isExpoPushToken = (t: string) => t.startsWith("ExponentPushToken");
    chunkPushNotifications = (m: unknown[]) => [m];
    sendPushNotificationsAsync = sendMock;
  }
  return { Expo };
});

import { sendExpoPush } from "./expo-client";
import type { PushMessage } from "./messages";

const MSG: PushMessage = {
  title: "t",
  body: "b",
  data: { kind: "transactions_to_review", route: "/x" },
};

beforeEach(() => sendMock.mockReset());

describe("sendExpoPush", () => {
  it("drops badly-formatted tokens before sending and reports them invalid", async () => {
    sendMock.mockResolvedValue([{ status: "ok", id: "1" }]);
    const res = await sendExpoPush(["ExponentPushToken[a]", "garbage"], MSG);
    expect(res.sentCount).toBe(1);
    expect(res.invalidTokens).toEqual(["garbage"]);
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("marks DeviceNotRegistered tickets' tokens invalid, positionally", async () => {
    sendMock.mockResolvedValue([
      { status: "ok", id: "1" },
      { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
    ]);
    const res = await sendExpoPush(["ExponentPushToken[a]", "ExponentPushToken[b]"], MSG);
    expect(res.invalidTokens).toEqual(["ExponentPushToken[b]"]);
  });

  it("does not call the SDK when there are no valid tokens", async () => {
    const res = await sendExpoPush(["garbage"], MSG);
    expect(res).toEqual({ sentCount: 0, invalidTokens: ["garbage"] });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
