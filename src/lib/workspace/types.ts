// src/lib/workspace/types.ts

/** A Microsoft identity-platform token response, normalized. */
export type MicrosoftTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string;
  idToken: string | null;
};

/** The id_token claims Foundry keys a connection on (`tid`, `oid`, `preferred_username`). */
export type IdTokenClaims = {
  tenantId: string;
  userObjectId: string;
  email: string;
};

export type WorkspaceProvider = "microsoft";

/** One person's state for a provider, as the firm roster shows it. */
export type MemberStatus = "off" | "not_connected" | "connected" | "needs_reconnect";

/** What the Calendar pane renders for the signed-in advisor. */
export type CalendarPaneState =
  | "firm_not_approved"
  | "member_off"
  | "connect"
  | "needs_reconnect"
  | "ready";

/** `"YYYY-MM-DDTHH:mm"` in the mailbox time zone, no offset. */
export type WallClock = string;

/** One calendar event as the Calendar pane renders it. */
export type WorkspaceEvent = {
  id: string;
  subject: string;
  start: WallClock;
  end: WallClock;
  isAllDay: boolean;
  isOrganizer: boolean;
  isCancelled: boolean;
  type: "singleInstance" | "occurrence" | "exception";
  attendees: { email: string; name: string | null }[];
  teamsUrl: string | null;
  webLink: string;
};

/** One open Microsoft To Do task. `dueDate` is `YYYY-MM-DD`. */
export type WorkspaceTodo = {
  source: "outlook";
  id: string;
  listId: string;
  title: string;
  dueDate: string | null;
  notes: string;
};

/** Why `GET /api/workspace/todos` came back without its Outlook half. */
export type OutlookError = "needs_reconnect" | "throttled" | "not_connected";

/** One attendee type-ahead suggestion: a CRM contact or a teammate. */
export type AttendeeSuggestion = { email: string; name: string; kind: "client" | "team" };
