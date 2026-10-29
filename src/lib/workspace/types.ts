// src/lib/workspace/types.ts

/** A Microsoft identity-platform token response, normalized. */
export type ProviderTokenSet = {
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
  meetingUrl: string | null;
  iCalUid: string | null;
  webLink: string;
};

/**
 * One open Microsoft To Do task. `dueDate` is `YYYY-MM-DD`. `notes` is the
 * plain-text body; formatted (HTML) notes arrive as "" with `notesAreHtml`,
 * and are edited in Outlook only.
 */
export type WorkspaceTodo = {
  provider: WorkspaceProvider;
  id: string;
  listId: string;
  title: string;
  dueDate: string | null;
  notes: string;
  notesAreHtml: boolean;
};

/**
 * Why `GET /api/workspace/todos` came back without its Outlook half:
 * `throttled` is Microsoft being busy; `unavailable` is any other Microsoft
 * failure, which a retry may not fix.
 */
export type OutlookError = "needs_reconnect" | "throttled" | "unavailable" | "not_connected";

/** One attendee type-ahead suggestion: a CRM contact or a teammate. */
export type AttendeeSuggestion = { email: string; name: string; kind: "client" | "team" };
