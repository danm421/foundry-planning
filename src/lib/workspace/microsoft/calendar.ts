// src/lib/workspace/microsoft/calendar.ts
import type { WallClock, WorkspaceEvent } from "../types";
import { addDays, overlappingDays } from "../week";
import { graphJson, graphPages, jsonInit, type GraphContext } from "./graph";

const EVENT_FIELDS =
  "id,subject,start,end,isAllDay,isOrganizer,isCancelled,type,attendees,onlineMeeting,iCalUId,webLink";

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
  iCalUId?: string | null;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink: string;
};

/** Graph's `2026-10-28T10:00:00.0000000` → `2026-10-28T10:00`. */
const fromGraphTime = (dateTime: string): WallClock => dateTime.slice(0, 16);

/** A wall clock as Graph's `dateTimeTimeZone`. */
const toGraphTime = (w: WallClock, timeZone: string) => ({ dateTime: `${w}:00`, timeZone });

function toWorkspaceEvent(e: GraphEvent): WorkspaceEvent {
  const attendees: WorkspaceEvent["attendees"] = [];
  for (const a of e.attendees ?? []) {
    const email = a.emailAddress?.address;
    if (email) attendees.push({ email, name: a.emailAddress?.name || null });
  }
  return {
    id: e.id,
    subject: e.subject ?? "",
    start: fromGraphTime(e.start.dateTime),
    end: fromGraphTime(e.end.dateTime),
    isAllDay: e.isAllDay,
    isOrganizer: e.isOrganizer,
    isCancelled: e.isCancelled,
    type: e.type,
    attendees,
    meetingUrl: e.onlineMeeting?.joinUrl ?? null,
    iCalUid: e.iCalUId ?? null,
    webLink: e.webLink,
  };
}

const eventPath = (id: string) => `/me/events/${encodeURIComponent(id)}`;

/**
 * The mailbox's own time zone name (Windows or IANA, as Graph reports it). A
 * mailbox never opened in Outlook has none yet and Graph answers 204; UTC is
 * what Graph itself uses until one is set.
 */
export async function readMailboxTimeZone(ctx: GraphContext): Promise<string | null> {
  const res = await graphJson<{ value?: string } | undefined>(ctx, "/me/mailboxSettings/timeZone");
  return res?.value || null;
}

export async function getMailboxTimeZone(ctx: GraphContext): Promise<string> {
  return (await readMailboxTimeZone(ctx)) ?? "UTC";
}

/** Non-cancelled events overlapping `[startDate, startDate + days)` local days, as wall-clock times in `timeZone`. */
export async function listEvents(
  ctx: GraphContext,
  opts: { startDate: string; days: number; timeZone: string },
): Promise<WorkspaceEvent[]> {
  const query = new URLSearchParams({
    startDateTime: `${addDays(opts.startDate, -1)}T00:00:00`,
    endDateTime: `${addDays(opts.startDate, opts.days + 1)}T00:00:00`,
    $top: "250",
    $select: EVENT_FIELDS,
  });
  const events = await graphPages<GraphEvent>(ctx, `/me/calendarView?${query}`, { timeZone: opts.timeZone });
  // calendarView reads offset-less bounds as UTC, so the request is widened a day each side
  // and the events are trimmed to the mailbox's local window here.
  return overlappingDays(events.filter((e) => !e.isCancelled).map(toWorkspaceEvent), opts.startDate, opts.days);
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

/** Creates an event; with `video`, adds a Teams meeting when the calendar allows it. */
export async function createEvent(
  ctx: GraphContext,
  input: {
    subject: string;
    start: WallClock;
    end: WallClock;
    attendees: string[];
    video: boolean;
    timeZone: string;
  },
): Promise<{ event: WorkspaceEvent; videoFailed: boolean }> {
  let teamsAllowed = false;
  if (input.video) {
    const cal = await graphJson<{ allowedOnlineMeetingProviders?: string[] }>(
      ctx,
      "/me/calendar?$select=allowedOnlineMeetingProviders",
    );
    teamsAllowed = (cal.allowedOnlineMeetingProviders ?? []).includes("teamsForBusiness");
  }
  const body = {
    subject: input.subject,
    start: toGraphTime(input.start, input.timeZone),
    end: toGraphTime(input.end, input.timeZone),
    attendees: input.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
    ...(teamsAllowed ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
  };
  const created = await graphJson<GraphEvent>(ctx, "/me/events", jsonInit("POST", body, input.timeZone));
  return { event: toWorkspaceEvent(created), videoFailed: input.video && !teamsAllowed };
}

/** Moves an event; Outlook notifies the attendees. */
export async function moveEvent(
  ctx: GraphContext,
  eventId: string,
  input: { start: WallClock; end: WallClock; timeZone: string },
): Promise<WorkspaceEvent> {
  const body = { start: toGraphTime(input.start, input.timeZone), end: toGraphTime(input.end, input.timeZone) };
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
