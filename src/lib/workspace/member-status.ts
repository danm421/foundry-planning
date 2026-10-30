// src/lib/workspace/member-status.ts
import type { MemberStatus } from "./types";

type ConnectionLike = { status: "connected" | "needs_reconnect" } | null;

/** A switched-off person never reads as connected, whatever row they still hold. */
export function memberStatus(input: { enabled: boolean; connection: ConnectionLike }): MemberStatus {
  if (!input.enabled) return "off";
  if (!input.connection) return "not_connected";
  return input.connection.status;
}
