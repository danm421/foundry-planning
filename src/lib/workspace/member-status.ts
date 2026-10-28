// src/lib/workspace/member-status.ts
import type { CalendarPaneState, MemberStatus } from "./types";

type ConnectionLike = { status: "connected" | "needs_reconnect" } | null;

/** A switched-off person never reads as connected, whatever row they still hold. */
export function memberStatus(input: { enabled: boolean; connection: ConnectionLike }): MemberStatus {
  if (!input.enabled) return "off";
  if (!input.connection) return "not_connected";
  return input.connection.status;
}

export function calendarPaneState(input: {
  approved: boolean;
  enabled: boolean;
  connection: ConnectionLike;
}): CalendarPaneState {
  if (!input.approved) return "firm_not_approved";
  if (!input.enabled) return "member_off";
  if (!input.connection) return "connect";
  return input.connection.status === "needs_reconnect" ? "needs_reconnect" : "ready";
}
