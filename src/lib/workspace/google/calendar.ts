// src/lib/workspace/google/calendar.ts
import { randomUUID } from "node:crypto";
import { ProviderRequestError } from "../errors";
import type { WallClock, WorkspaceEvent } from "../types";
import { addDays } from "../week";
import { googleJson, googlePages, type GoogleContext } from "./api";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
/** No working-location or birthday markers. */
const EVENT_TYPES = ["default", "outOfOffice", "focusTime", "fromGmail"];

type GoogleEventTime = { dateTime?: string; date?: string; timeZone?: string };
type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  organizer?: { self?: boolean };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  recurringEventId?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
    createRequest?: { status?: { statusCode?: string } };
  };
  iCalUID?: string;
  htmlLink: string;
};

const eventUrl = (id: string) => `${EVENTS_URL}/${encodeURIComponent(id)}`;

/** Google's `2026-11-02T09:00:00-06:00` → `2026-11-02T09:00`; an all-day `date` → midnight. */
const fromGoogleTime = (t: GoogleEventTime): WallClock =>
  t.dateTime ? t.dateTime.slice(0, 16) : `${t.date}T00:00`;

/** A wall clock as Google's `EventDateTime`. */
const toGoogleTime = (w: WallClock, timeZone: string) => ({ dateTime: `${w}:00`, timeZone });

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const isGuest = (a: { self?: boolean; resource?: boolean }) => !a.self && !a.resource;

function toWorkspaceEvent(e: GoogleEvent): WorkspaceEvent {
  const attendees: WorkspaceEvent["attendees"] = [];
  for (const a of e.attendees ?? []) {
    if (a.email && isGuest(a)) attendees.push({ email: a.email, name: a.displayName || null });
  }
  return {
    id: e.id,
    subject: e.summary ?? "",
    start: fromGoogleTime(e.start),
    end: fromGoogleTime(e.end),
    isAllDay: !e.start.dateTime,
    isOrganizer: e.organizer?.self === true,
    isCancelled: false,
    type: e.recurringEventId ? "occurrence" : "singleInstance",
    attendees,
    meetingUrl:
      e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null,
    iCalUid: e.iCalUID ?? null,
    webLink: e.htmlLink,
  };
}

/** The main calendar's IANA time zone, or null. */
export async function getTimeZone(ctx: GoogleContext): Promise<string | null> {
  const res = await googleJson<{ timeZone?: string }>(ctx, `${EVENTS_URL}?maxResults=1`);
  return res.timeZone || null;
}

/** Non-cancelled events overlapping `[startDate, startDate + days)` local days, as wall-clock times in `timeZone`. */
export async function listEvents(
  ctx: GoogleContext,
  opts: { startDate: string; days: number; timeZone: string },
): Promise<WorkspaceEvent[]> {
  const query = new URLSearchParams({
    timeMin: `${addDays(opts.startDate, -1)}T00:00:00Z`,
    timeMax: `${addDays(opts.startDate, opts.days + 1)}T00:00:00Z`,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeZone: opts.timeZone,
  });
  for (const type of EVENT_TYPES) query.append("eventTypes", type);
  const events = await googlePages<GoogleEvent>(ctx, `${EVENTS_URL}?${query}`, "items");
  // The bounds are widened a day each side (they are instants, not local days),
  // so the events are trimmed to the local window here, as the Microsoft adapter does.
  const lo = `${opts.startDate}T00:00`;
  const hi = `${addDays(opts.startDate, opts.days)}T00:00`;
  return events
    .filter((e) => e.status !== "cancelled")
    .map(toWorkspaceEvent)
    .filter((e) => e.start < hi && e.end > lo);
}

/** Fresh organizer/attendee facts, read just before an edit. */
export async function getEventForEdit(
  ctx: GoogleContext,
  eventId: string,
): Promise<{ isOrganizer: boolean; hasAttendees: boolean }> {
  const e = await googleJson<GoogleEvent>(ctx, eventUrl(eventId));
  return { isOrganizer: e.organizer?.self === true, hasAttendees: (e.attendees ?? []).some(isGuest) };
}

/** Creates an event, emailing the guests; with `video`, adds a Meet link when Google allows it. */
export async function createEvent(
  ctx: GoogleContext,
  input: {
    subject: string;
    start: WallClock;
    end: WallClock;
    attendees: string[];
    video: boolean;
    timeZone: string;
  },
): Promise<{ event: WorkspaceEvent; videoFailed: boolean }> {
  const body = {
    summary: input.subject,
    start: toGoogleTime(input.start, input.timeZone),
    end: toGoogleTime(input.end, input.timeZone),
    attendees: input.attendees.map((email) => ({ email })),
  };
  const create = (video: boolean) =>
    googleJson<GoogleEvent>(
      ctx,
      `${EVENTS_URL}?${new URLSearchParams({ sendUpdates: "all", ...(video ? { conferenceDataVersion: "1" } : {}) })}`,
      jsonInit("POST", {
        ...body,
        ...(video
          ? {
              conferenceData: {
                createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
              },
            }
          : {}),
      }),
    );

  let created: GoogleEvent;
  let videoFailed = false;
  if (input.video) {
    try {
      created = await create(true);
      videoFailed = created.conferenceData?.createRequest?.status?.statusCode === "failure";
    } catch (err) {
      // A calendar that can't host Meet rejects the conference request; the event itself is still wanted.
      if (!(err instanceof ProviderRequestError) || err.status !== 400) throw err;
      created = await create(false);
      videoFailed = true;
    }
  } else {
    created = await create(false);
  }
  return { event: toWorkspaceEvent(created), videoFailed };
}

/** Moves an event; Google emails the guests. */
export async function moveEvent(
  ctx: GoogleContext,
  eventId: string,
  input: { start: WallClock; end: WallClock; timeZone: string },
): Promise<WorkspaceEvent> {
  const body = { start: toGoogleTime(input.start, input.timeZone), end: toGoogleTime(input.end, input.timeZone) };
  const moved = await googleJson<GoogleEvent>(ctx, `${eventUrl(eventId)}?sendUpdates=all`, jsonInit("PATCH", body));
  return toWorkspaceEvent(moved);
}

/** Deletes the event; with `sendUpdates=all` Google tells any guests, so `hasAttendees` needs no branch. */
export async function cancelEvent(ctx: GoogleContext, eventId: string): Promise<void> {
  await googleJson<void>(ctx, `${eventUrl(eventId)}?sendUpdates=all`, { method: "DELETE" });
}
