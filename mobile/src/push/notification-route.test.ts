import { describe, it, expect } from "vitest";
import { routeForNotificationData } from "./notification-route";

describe("routeForNotificationData", () => {
  it("returns the route string from valid data", () => {
    expect(routeForNotificationData({ kind: "reconnect_required", route: "/plaid/x", itemId: "x" })).toBe("/plaid/x");
  });
  it("returns null for missing/empty route", () => {
    expect(routeForNotificationData({ kind: "x" })).toBeNull();
    expect(routeForNotificationData({ route: "" })).toBeNull();
  });
  it("returns null for non-object data", () => {
    expect(routeForNotificationData(undefined)).toBeNull();
    expect(routeForNotificationData("nope")).toBeNull();
  });
});
