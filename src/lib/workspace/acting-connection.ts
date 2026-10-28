// src/lib/workspace/acting-connection.ts
import { hasMemberAccess } from "./access";
import { getFirmApproval } from "./approvals";
import { getUserConnection, type WorkspaceConnection } from "./connections";
import { WorkspaceNotConnectedError, WorkspaceReconnectRequiredError } from "./errors";
import { calendarPaneState } from "./member-status";
import type { WorkspaceProvider } from "./types";

/**
 * THE gate every Workspace read or write goes through: whose Microsoft
 * connection a request acts with. Checks, in order, the firm's approval, the
 * actor's member switch, and that the actor has a usable connection.
 *
 * Today it returns only the actor's OWN connection. A future delegate or
 * assistant rule (acting on another advisor's calendar) belongs here and
 * nowhere else, so no route ever takes a user id to read someone's calendar.
 *
 * Throws `WorkspaceNotConnectedError` with the Calendar pane state, or
 * `WorkspaceReconnectRequiredError` for a revoked or expired sign-in. A
 * connection that can't be read (e.g. a token that won't decrypt) propagates
 * as-is: it is a key misconfiguration, not the advisor's to fix.
 */
export async function resolveActingConnection(input: {
  firmId: string;
  actorUserId: string;
  provider: WorkspaceProvider;
}): Promise<WorkspaceConnection> {
  const { firmId, actorUserId, provider } = input;
  const approved = (await getFirmApproval(firmId, provider)) !== null;
  const enabled = approved && (await hasMemberAccess(firmId, actorUserId, provider));
  const connection = enabled ? await getUserConnection(firmId, actorUserId, provider) : null;

  const state = calendarPaneState({ approved, enabled, connection });
  if (state === "needs_reconnect") throw new WorkspaceReconnectRequiredError();
  if (state !== "ready") throw new WorkspaceNotConnectedError(state);
  // "ready" implies a connection; calendarPaneState checked it.
  return connection as WorkspaceConnection;
}
