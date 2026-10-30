import { describe, it, expect } from "vitest";
import { memberStatus } from "./member-status";

describe("memberStatus", () => {
  it("off when not enabled", () => {
    expect(memberStatus({ enabled: false, connection: null })).toBe("off");
  });
  it("a switched-off person never reads as connected", () => {
    expect(memberStatus({ enabled: false, connection: { status: "connected" } })).toBe("off");
  });
  it("not_connected when enabled with no connection", () => {
    expect(memberStatus({ enabled: true, connection: null })).toBe("not_connected");
  });
  it("needs_reconnect", () => {
    expect(memberStatus({ enabled: true, connection: { status: "needs_reconnect" } })).toBe("needs_reconnect");
  });
  it("connected", () => {
    expect(memberStatus({ enabled: true, connection: { status: "connected" } })).toBe("connected");
  });
});
