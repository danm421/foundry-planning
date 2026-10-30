// src/lib/workspace/provider-adapter.ts
import type { WorkspaceConnection } from "./connections";
import type { WallClock, WorkspaceEvent, WorkspaceProvider, WorkspaceTodo } from "./types";
import { googleAdapter } from "./google/adapter";
import { microsoftAdapter } from "./microsoft/adapter";

export type TodoPatch = { title?: string; dueDate?: string | null; notes?: string; completed?: boolean };

/** What the Workspace routes need from a calendar and to-do provider; times are wall clocks in IANA `timeZone`. */
export interface WorkspaceProviderAdapter {
  /** IANA, or null when the account reports none. */
  getTimeZone(conn: WorkspaceConnection): Promise<string | null>;
  listEvents(
    conn: WorkspaceConnection,
    opts: { startDate: string; days: number; timeZone: string },
  ): Promise<WorkspaceEvent[]>;
  getEventForEdit(conn: WorkspaceConnection, eventId: string): Promise<{ isOrganizer: boolean; hasAttendees: boolean }>;
  createEvent(
    conn: WorkspaceConnection,
    input: { subject: string; start: WallClock; end: WallClock; attendees: string[]; video: boolean; timeZone: string },
  ): Promise<{ event: WorkspaceEvent; videoFailed: boolean }>;
  moveEvent(
    conn: WorkspaceConnection,
    eventId: string,
    input: { start: WallClock; end: WallClock; timeZone: string },
  ): Promise<WorkspaceEvent>;
  cancelEvent(conn: WorkspaceConnection, eventId: string, opts: { hasAttendees: boolean }): Promise<void>;
  listOpenTodos(conn: WorkspaceConnection): Promise<WorkspaceTodo[]>;
  createTodo(
    conn: WorkspaceConnection,
    input: { title: string; dueDate: string | null; notes: string },
  ): Promise<WorkspaceTodo>;
  updateTodo(conn: WorkspaceConnection, input: { listId: string; taskId: string; patch: TodoPatch }): Promise<void>;
  /** Best effort; never throws. */
  revoke(conn: WorkspaceConnection): Promise<void>;
}

export function adapterFor(provider: WorkspaceProvider): WorkspaceProviderAdapter {
  return provider === "microsoft" ? microsoftAdapter : googleAdapter;
}

/** Only an organizer can change a live event. */
export function canEditEvent(e: WorkspaceEvent): boolean {
  return e.isOrganizer && !e.isCancelled;
}
