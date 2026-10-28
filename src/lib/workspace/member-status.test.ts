import { describe, it, expect } from "vitest";
import { memberStatus, calendarPaneState } from "./member-status";

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

describe("calendarPaneState", () => {
  it("firm_not_approved", () => {
    expect(calendarPaneState({ approved: false, enabled: true, connection: { status: "connected" } })).toBe("firm_not_approved");
  });
  it("member_off", () => {
    expect(calendarPaneState({ approved: true, enabled: false, connection: null })).toBe("member_off");
  });
  it("connect", () => {
    expect(calendarPaneState({ approved: true, enabled: true, connection: null })).toBe("connect");
  });
  it("needs_reconnect", () => {
    expect(calendarPaneState({ approved: true, enabled: true, connection: { status: "needs_reconnect" } })).toBe("needs_reconnect");
  });
  it("ready", () => {
    expect(calendarPaneState({ approved: true, enabled: true, connection: { status: "connected" } })).toBe("ready");
  });
});
