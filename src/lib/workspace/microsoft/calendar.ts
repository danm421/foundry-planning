// src/lib/workspace/microsoft/calendar.ts
import type { WallClock, WorkspaceEvent } from "../types";
import { graphJson, graphPages, type GraphContext } from "./graph";

const EVENT_FIELDS =
  "id,subject,start,end,isAllDay,isOrganizer,isCancelled,type,attendees,onlineMeeting,webLink";

type GraphEvent = {
  id: string;
  subject: string | null;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay: boolean;
  isOrganizer: boolean;
  isCancelled: boolean;
  type: WorkspaceEvent["type"];
  attendees?: { emailAddress?: { address?: string; name?: string } }[];
  onlineMeeting?: { joinUrl?: string } | null;
  webLink: string;
};

/** Graph's `2026-10-28T10:00:00.0000000` → `2026-10-28T10:00`. */
const toWallClock = (dateTime: string): WallClock => dateTime.slice(0, 16);

function toWorkspaceEvent(e: GraphEvent): WorkspaceEvent {
  const attendees: WorkspaceEvent["attendees"] = [];
  for (const a of e.attendees ?? []) {
    const email = a.emailAddress?.address;
    if (email) attendees.push({ email, name: a.emailAddress?.name || null });
  }
  return {
    id: e.id,
    subject: e.subject ?? "",
    start: toWallClock(e.start.dateTime),
    end: toWallClock(e.end.dateTime),
    isAllDay: e.isAllDay,
    isOrganizer: e.isOrganizer,
    isCancelled: e.isCancelled,
    type: e.type,
    attendees,
    teamsUrl: e.onlineMeeting?.joinUrl ?? null,
    webLink: e.webLink,
  };
}

/** `YYYY-MM-DD` plus `days`, by calendar date (UTC math, so the machine's zone can't shift it). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const eventPath = (id: string) => `/me/events/${encodeURIComponent(id)}`;
const jsonInit = (method: string, body: unknown, timeZone?: string) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  timeZone,
});

/** The mailbox's own time zone name (Windows or IANA, as Graph reports it). */
export async function getMailboxTimeZone(ctx: GraphContext): Promise<string> {
  const res = await graphJson<{ value: string }>(ctx, "/me/mailboxSettings/timeZone");
  return res.value;
}

/** Non-cancelled events in `[startDate, startDate + days)`, as wall-clock times in `timeZone`. */
export async function listEvents(
  ctx: GraphContext,
  opts: { startDate: string; days: number; timeZone: string },
): Promise<WorkspaceEvent[]> {
  const query = new URLSearchParams({
    startDateTime: `${opts.startDate}T00:00:00`,
    endDateTime: `${addDays(opts.startDate, opts.days)}T00:00:00`,
    $top: "250",
    $select: EVENT_FIELDS,
  });
  const events = await graphPages<GraphEvent>(ctx, `/me/calendarView?${query}`, { timeZone: opts.timeZone });
  return events.filter((e) => !e.isCancelled).map(toWorkspaceEvent);
}

/** Only an organizer can change a live event. */
export function canEditEvent(e: WorkspaceEvent): boolean {
  return e.isOrganizer && !e.isCancelled;
}

/** Fresh organizer/attendee facts, read just before an edit. */
export async function getEventForEdit(
  ctx: GraphContext,
  eventId: string,
): Promise<{ isOrganizer: boolean; hasAttendees: boolean }> {
  const e = await graphJson<{ isOrganizer: boolean; attendees?: unknown[] }>(
    ctx,
    `${eventPath(eventId)}?$select=isOrganizer,attendees`,
  );
  return { isOrganizer: e.isOrganizer, hasAttendees: (e.attendees ?? []).length > 0 };
}

/** Creates an event; with `teams`, adds a Teams meeting when the calendar allows it. */
export async function createEvent(
  ctx: GraphContext,
  input: {
    subject: string;
    start: WallClock;
    end: WallClock;
    attendees: string[];
    teams: boolean;
    timeZone: string;
  },
): Promise<{ event: WorkspaceEvent; teamsFailed: boolean }> {
  let teamsAllowed = false;
  if (input.teams) {
    const cal = await graphJson<{ allowedOnlineMeetingProviders?: string[] }>(
      ctx,
      "/me/calendar?$select=allowedOnlineMeetingProviders",
    );
    teamsAllowed = (cal.allowedOnlineMeetingProviders ?? []).includes("teamsForBusiness");
  }
  const body = {
    subject: input.subject,
    start: { dateTime: `${input.start}:00`, timeZone: input.timeZone },
    end: { dateTime: `${input.end}:00`, timeZone: input.timeZone },
    attendees: input.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
    ...(teamsAllowed ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
  const created = await graphJson<GraphEvent>(ctx, "/me/events", jsonInit("POST", body, input.timeZone));
  return { event: toWorkspaceEvent(created), teamsFailed: input.teams && !teamsAllowed };
}

/** Moves an event; Outlook notifies the attendees. */
export async function moveEvent(
  ctx: GraphContext,
  eventId: string,
  input: { start: WallClock; end: WallClock; timeZone: string },
): Promise<WorkspaceEvent> {
  const body = {
    start: { dateTime: `${input.start}:00`, timeZone: input.timeZone },
    end: { dateTime: `${input.end}:00`, timeZone: input.timeZone },
  };
  const moved = await graphJson<GraphEvent>(ctx, eventPath(eventId), jsonInit("PATCH", body, input.timeZone));
  return toWorkspaceEvent(moved);
}

/** Cancels (notifying attendees) when there are attendees; otherwise just deletes. */
export async function cancelEvent(
  ctx: GraphContext,
  eventId: string,
  opts: { hasAttendees: boolean },
): Promise<void> {
  if (opts.hasAttendees) {
    await graphJson<void>(ctx, `${eventPath(eventId)}/cancel`, jsonInit("POST", { comment: "" }));
  } else {
    await graphJson<void>(ctx, eventPath(eventId), { method: "DELETE" });
  }
}
