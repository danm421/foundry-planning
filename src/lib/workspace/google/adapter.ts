// src/lib/workspace/google/adapter.ts
import type { WorkspaceProviderAdapter } from "../provider-adapter";
import type { GoogleContext } from "./api";
import { cancelEvent, createEvent, getEventForEdit, getTimeZone, listEvents, moveEvent } from "./calendar";
import { revokeToken } from "./oauth";
import { createTodo, listOpenTodos, updateTodo } from "./tasks";

const ctx = (conn: GoogleContext["conn"]): GoogleContext => ({ conn });

/** Google takes IANA zone names as they are. */
export const googleAdapter: WorkspaceProviderAdapter = {
  getTimeZone: (conn) => getTimeZone(ctx(conn)),
  listEvents: (conn, opts) => listEvents(ctx(conn), opts),
  getEventForEdit: (conn, eventId) => getEventForEdit(ctx(conn), eventId),
  createEvent: (conn, input) => createEvent(ctx(conn), input),
  moveEvent: (conn, eventId, input) => moveEvent(ctx(conn), eventId, input),
  cancelEvent: (conn, eventId) => cancelEvent(ctx(conn), eventId),
  listOpenTodos: (conn) => listOpenTodos(ctx(conn)),
  createTodo: (conn, input) => createTodo(ctx(conn), input),
  updateTodo: (conn, input) => updateTodo(ctx(conn), input),
  revoke: (conn) => revokeToken(conn.refreshToken),
};
