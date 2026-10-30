// src/lib/workspace/types.ts

/** A provider's token response (Microsoft identity platform or Google), normalized. */
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

export type WorkspaceProvider = "microsoft" | "google";

/** One connected account as the Workspace screen lists it (no tokens). */
export type AccountSummary = {
  id: string;
  provider: WorkspaceProvider;
  email: string;
  status: "connected" | "needs_reconnect";
  connectedAt: string; // ISO
};

/** What the Calendar pane renders for the signed-in advisor. */
export type CalendarPaneState = "connect" | "impersonating" | "ready";

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
 * One open to-do: a Microsoft To Do or Google Tasks task. `dueDate` is
 * `YYYY-MM-DD`. `notes` is the plain-text body; Microsoft's formatted (HTML)
 * notes arrive as "" with `notesAreHtml`, and are edited in Outlook only
 * (Google's notes are always plain text).
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

/** Why one connected account's half of the week or to-do list is missing. */
export type AccountError = "needs_reconnect" | "throttled" | "unavailable";

/** One attendee type-ahead suggestion: a CRM contact or a teammate. */
export type AttendeeSuggestion = { email: string; name: string; kind: "client" | "team" };
