// src/lib/workspace/microsoft/adapter.ts
import type { WorkspaceProviderAdapter } from "../provider-adapter";
import { ianaToWindows, isValidIanaZone, windowsToIana } from "../time-zones";
import {
  cancelEvent,
  createEvent,
  getEventForEdit,
  listEvents,
  moveEvent,
  readMailboxTimeZone,
} from "./calendar";
import type { GraphContext } from "./graph";
import { createTodo, listOpenTodos, updateTodo } from "./todo";

const ctx = (conn: GraphContext["conn"]): GraphContext => ({ conn });

/** Graph speaks Windows zone names, so every call converts from IANA. */
export const microsoftAdapter: WorkspaceProviderAdapter = {
  async getTimeZone(conn) {
    const name = await readMailboxTimeZone(ctx(conn));
    const zone = name === null ? null : windowsToIana(name);
    // Graph reports `tzone://Microsoft/Custom` for custom zones, which passes through as "IANA".
    return zone !== null && isValidIanaZone(zone) ? zone : null;
  },
  listEvents: (conn, opts) => listEvents(ctx(conn), { ...opts, timeZone: ianaToWindows(opts.timeZone) }),
  getEventForEdit: (conn, eventId) => getEventForEdit(ctx(conn), eventId),
  createEvent: (conn, input) => createEvent(ctx(conn), { ...input, timeZone: ianaToWindows(input.timeZone) }),
  moveEvent: (conn, eventId, input) => moveEvent(ctx(conn), eventId, { ...input, timeZone: ianaToWindows(input.timeZone) }),
  cancelEvent: (conn, eventId, opts) => cancelEvent(ctx(conn), eventId, opts),
  listOpenTodos: (conn) => listOpenTodos(ctx(conn)),
  createTodo: (conn, input) => createTodo(ctx(conn), input),
  updateTodo: (conn, input) => updateTodo(ctx(conn), input),
  async revoke() {
    // Phase-1 parity: Microsoft sign-ins are not revoked on disconnect.
  },
};
