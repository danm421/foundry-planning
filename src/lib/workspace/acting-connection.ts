// src/lib/workspace/acting-connection.ts
import { uuidRegex } from "@/lib/schemas/common";
import { getConnectionById, listUserConnections, type WorkspaceConnection } from "./connections";
import {
  WorkspaceConnectionNotFoundError,
  WorkspaceImpersonationError,
  WorkspaceReconnectRequiredError,
} from "./errors";
import { isImpersonating } from "./impersonation";

/** Ops "sign in as" sessions get no provider data: refused before anything is read. */
async function refuseImpersonation(): Promise<void> {
  if (await isImpersonating()) throw new WorkspaceImpersonationError();
}

/**
 * THE gate every Workspace provider read or write goes through, with
 * `listActingConnections`: which connection a request acts with.
 *
 * Today the actor acts with their OWN connections only. This is the one place
 * a delegate rule goes (an assistant acting on another advisor's calendar), so
 * no route ever takes a user id to read someone's calendar.
 *
 * Throws `WorkspaceImpersonationError`; `WorkspaceConnectionNotFoundError`
 * when no row has the id or it isn't the actor's; or
 * `WorkspaceReconnectRequiredError` for a revoked or expired sign-in, unless
 * `allowNeedsReconnect` (so one can still be disconnected). A connection that
 * can't be read (e.g. a token that won't decrypt) propagates as-is: it is a
 * key misconfiguration, not the advisor's to fix.
 */
export async function resolveActingConnection(input: {
  firmId: string;
  actorUserId: string;
  connectionId: string;
  allowNeedsReconnect?: boolean;
}): Promise<WorkspaceConnection> {
  await refuseImpersonation();
  // Not a uuid names no connection; querying the uuid column with it would fail as a 500.
  if (!uuidRegex.test(input.connectionId)) throw new WorkspaceConnectionNotFoundError();

  const conn = await getConnectionById(input.connectionId);
  // getConnectionById checks no firm: both the firm and the owner must be the actor's.
  if (!conn || conn.firmId !== input.firmId || conn.userId !== input.actorUserId) {
    throw new WorkspaceConnectionNotFoundError();
  }
  if (conn.status === "needs_reconnect" && !input.allowNeedsReconnect) {
    throw new WorkspaceReconnectRequiredError();
  }
  return conn;
}

/** Every connection the actor may act with (their own in the firm), every status, oldest first. */
export async function listActingConnections(input: {
  firmId: string;
  actorUserId: string;
}): Promise<WorkspaceConnection[]> {
  await refuseImpersonation();
  return listUserConnections(input.firmId, input.actorUserId);
}
