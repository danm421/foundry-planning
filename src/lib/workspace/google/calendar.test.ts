import { describe, it, expect, vi } from "vitest";
import { ProviderRequestError } from "../errors";
import { cancelEvent, createEvent, getEventForEdit, getTimeZone, listEvents, moveEvent } from "./calendar";
import { json, setup } from "./test-fixtures";

vi.mock("../connections", () => ({
  storeRefreshedTokens: vi.fn(),
  markNeedsReconnect: vi.fn(),
}));

function googleEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    summary: "Review",
    start: { dateTime: "2026-11-02T09:00:00-06:00", timeZone: "America/Chicago" },
    end: { dateTime: "2026-11-02T10:00:00-06:00", timeZone: "America/Chicago" },
    htmlLink: "https://calendar.google.com/event?eid=e1",
    ...overrides,
  };
}

const WINDOW = { startDate: "2026-11-02", days: 7, timeZone: "America/Chicago" };

describe("listEvents", () => {
  it("asks for the widened UTC window with the local zone and the four event types", async () => {
    const { ctx, call } = setup(json({ items: [] }));
    await listEvents(ctx, WINDOW);
    const q = call(0).url.searchParams;
    expect(q.get("timeZone")).toBe("America/Chicago");
    expect(q.get("singleEvents")).toBe("true");
    expect(q.get("orderBy")).toBe("startTime");
    expect(q.get("maxResults")).toBe("250");
    expect(q.get("timeMin")).toBe("2026-11-01T00:00:00Z");
    expect(q.get("timeMax")).toBe("2026-11-10T00:00:00Z");
    expect(q.getAll("eventTypes")).toEqual(["default", "outOfOffice", "focusTime", "fromGmail"]);
    expect(q.has("sendUpdates")).toBe(false);
  });

  it("maps a timed event to its wall clock, dropping the offset", async () => {
    const { ctx } = setup(json({ items: [googleEvent()] }));
    const [e] = await listEvents(ctx, WINDOW);
    expect(e).toMatchObject({
      id: "e1",
      subject: "Review",
      start: "2026-11-02T09:00",
      end: "2026-11-02T10:00",
      isAllDay: false,
      isCancelled: false,
      type: "singleInstance",
      webLink: "https://calendar.google.com/event?eid=e1",
      iCalUid: null,
      meetingUrl: null,
    });
  });

  it("maps an all-day event to midnight to midnight", async () => {
    const { ctx } = setup(json({ items: [googleEvent({ start: { date: "2026-11-03" }, end: { date: "2026-11-04" } })] }));
    const [e] = await listEvents(ctx, WINDOW);
    expect(e).toMatchObject({ isAllDay: true, start: "2026-11-03T00:00", end: "2026-11-04T00:00" });
  });

  it("drops cancelled events", async () => {
    const { ctx } = setup(json({ items: [googleEvent({ status: "cancelled" }), googleEvent({ id: "e2" })] }));
    expect((await listEvents(ctx, WINDOW)).map((e) => e.id)).toEqual(["e2"]);
  });

  it("trims events outside the local window", async () => {
    const before = googleEvent({
      id: "before",
      start: { dateTime: "2026-11-01T22:00:00-06:00" },
      end: { dateTime: "2026-11-01T23:00:00-06:00" },
    });
    const after = googleEvent({
      id: "after",
      start: { dateTime: "2026-11-09T00:00:00-06:00" },
      end: { dateTime: "2026-11-09T01:00:00-06:00" },
    });
    const { ctx } = setup(json({ items: [before, googleEvent(), after] }));
    expect((await listEvents(ctx, WINDOW)).map((e) => e.id)).toEqual(["e1"]);
  });

  it("excludes self and resource attendees, and reads the organizer flag", async () => {
    const { ctx } = setup(
      json({
        items: [
          googleEvent({
            organizer: { self: true },
            attendees: [
              { email: "me@gmail.test", self: true },
              { email: "room@resource.calendar.google.com", resource: true },
              { email: "pat@client.test", displayName: "Pat" },
              { email: "lee@client.test" },
            ],
          }),
        ],
      }),
    );
    const [e] = await listEvents(ctx, WINDOW);
    expect(e.isOrganizer).toBe(true);
    expect(e.attendees).toEqual([
      { email: "pat@client.test", name: "Pat" },
      { email: "lee@client.test", name: null },
    ]);
  });

  it("marks an instance of a recurring series as an occurrence", async () => {
    const { ctx } = setup(json({ items: [googleEvent({ recurringEventId: "series" })] }));
    const [e] = await listEvents(ctx, WINDOW);
    expect(e.type).toBe("occurrence");
    expect(e.isOrganizer).toBe(false);
  });

  it("finds the meeting link on hangoutLink, else the first video entry point", async () => {
    const { ctx } = setup(
      json({
        items: [
          googleEvent({ id: "a", hangoutLink: "https://meet.google.com/aaa" }),
          googleEvent({
            id: "b",
            iCalUID: "b@google.com",
            conferenceData: {
              entryPoints: [
                { entryPointType: "phone", uri: "tel:+1" },
                { entryPointType: "video", uri: "https://zoom.test/b" },
              ],
            },
          }),
        ],
      }),
    );
    const [a, b] = await listEvents(ctx, WINDOW);
    expect(a.meetingUrl).toBe("https://meet.google.com/aaa");
    expect(b.meetingUrl).toBe("https://zoom.test/b");
    expect(b.iCalUid).toBe("b@google.com");
  });
});

describe("getTimeZone", () => {
  it("returns the calendar's zone", async () => {
    const { ctx, call } = setup(json({ timeZone: "America/Chicago", items: [] }));
    expect(await getTimeZone(ctx)).toBe("America/Chicago");
    expect(call(0).url.searchParams.get("maxResults")).toBe("1");
  });

  it("returns null when none is reported", async () => {
    const { ctx } = setup(json({ items: [] }));
    expect(await getTimeZone(ctx)).toBeNull();
  });
});

describe("getEventForEdit", () => {
  it("reads organizer and whether anyone besides me and rooms is invited", async () => {
    const { ctx, call } = setup(
      json(googleEvent({ organizer: { self: true }, attendees: [{ email: "me@x.test", self: true }, { email: "r@x.test", resource: true }] })),
      json(googleEvent({ attendees: [{ email: "pat@client.test" }] })),
    );
    expect(await getEventForEdit(ctx, "e/1")).toEqual({ isOrganizer: true, hasAttendees: false });
    expect(call(0).url.pathname).toBe("/calendar/v3/calendars/primary/events/e%2F1");
    expect(await getEventForEdit(ctx, "e1")).toEqual({ isOrganizer: false, hasAttendees: true });
  });
});

describe("createEvent", () => {
  const input = {
    subject: "Planning",
    start: "2026-11-02T09:00",
    end: "2026-11-02T10:00",
    attendees: ["pat@client.test"],
    video: false,
    timeZone: "America/Chicago",
  };

  it("posts the event with sendUpdates=all and wall-clock times", async () => {
    const { ctx, call } = setup(json(googleEvent({ summary: "Planning" })));
    const { event, videoFailed } = await createEvent(ctx, input);
    const c = call(0);
    expect(c.method).toBe("POST");
    expect(c.url.searchParams.get("sendUpdates")).toBe("all");
    expect(c.url.searchParams.has("conferenceDataVersion")).toBe(false);
    expect(c.body).toEqual({
      summary: "Planning",
      start: { dateTime: "2026-11-02T09:00:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-11-02T10:00:00", timeZone: "America/Chicago" },
      attendees: [{ email: "pat@client.test" }],
    });
    expect(event.subject).toBe("Planning");
    expect(videoFailed).toBe(false);
  });

  it("returns the times sent even when Google answers in the calendar's own zone", async () => {
    const { ctx } = setup(
      json(googleEvent({ start: { dateTime: "2026-11-02T10:00:00-05:00" }, end: { dateTime: "2026-11-02T11:00:00-05:00" } })),
    );
    const { event } = await createEvent(ctx, input);
    expect(event.start).toBe("2026-11-02T09:00");
    expect(event.end).toBe("2026-11-02T10:00");
  });

  it("asks for a Meet link when video is on", async () => {
    const { ctx, call } = setup(json(googleEvent({ hangoutLink: "https://meet.google.com/x" })));
    const { event, videoFailed } = await createEvent(ctx, { ...input, video: true });
    const c = call(0);
    expect(c.url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(c.url.searchParams.get("sendUpdates")).toBe("all");
    expect(c.body.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
    expect(c.body.conferenceData.createRequest.requestId).toEqual(expect.any(String));
    expect(event.meetingUrl).toBe("https://meet.google.com/x");
    expect(videoFailed).toBe(false);
  });

  it("retries without the conference after a 400 and reports videoFailed", async () => {
    const { ctx, call, fetchImpl } = setup(json({ error: { errors: [{ reason: "invalid" }] } }, 400), json(googleEvent()));
    const { videoFailed } = await createEvent(ctx, { ...input, video: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(call(1).url.searchParams.has("conferenceDataVersion")).toBe(false);
    expect(call(1).url.searchParams.get("sendUpdates")).toBe("all");
    expect(call(1).body.conferenceData).toBeUndefined();
    expect(videoFailed).toBe(true);
  });

  it("does not retry other failures", async () => {
    const { ctx, fetchImpl } = setup(json({ error: { errors: [{ reason: "forbidden" }] } }, 403));
    await expect(createEvent(ctx, { ...input, video: true })).rejects.toBeInstanceOf(ProviderRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports videoFailed when Google answers a failed conference request", async () => {
    const { ctx } = setup(json(googleEvent({ conferenceData: { createRequest: { status: { statusCode: "failure" } } } })));
    expect((await createEvent(ctx, { ...input, video: true })).videoFailed).toBe(true);
  });
});

describe("moveEvent", () => {
  it("patches start and end with sendUpdates=all", async () => {
    const { ctx, call } = setup(json(googleEvent({ start: { dateTime: "2026-11-03T09:00:00-06:00" }, end: { dateTime: "2026-11-03T10:00:00-06:00" } })));
    const moved = await moveEvent(ctx, "e1", { start: "2026-11-03T09:00", end: "2026-11-03T10:00", timeZone: "America/Chicago" });
    const c = call(0);
    expect(c.method).toBe("PATCH");
    expect(c.url.pathname).toBe("/calendar/v3/calendars/primary/events/e1");
    expect(c.url.searchParams.get("sendUpdates")).toBe("all");
    expect(c.body).toEqual({
      start: { dateTime: "2026-11-03T09:00:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-11-03T10:00:00", timeZone: "America/Chicago" },
    });
    expect(moved.start).toBe("2026-11-03T09:00");
  });
});

describe("moveEvent zones", () => {
  it("returns the times sent even when Google answers in the calendar's own zone", async () => {
    const { ctx } = setup(
      json(googleEvent({ start: { dateTime: "2026-11-03T10:00:00-05:00" }, end: { dateTime: "2026-11-03T11:00:00-05:00" } })),
    );
    const moved = await moveEvent(ctx, "e1", { start: "2026-11-03T09:00", end: "2026-11-03T10:00", timeZone: "America/Chicago" });
    expect(moved.start).toBe("2026-11-03T09:00");
    expect(moved.end).toBe("2026-11-03T10:00");
  });
});

describe("cancelEvent", () => {
  it("deletes with sendUpdates=all", async () => {
    const { ctx, call } = setup(json(undefined, 204));
    await cancelEvent(ctx, "e1");
    const c = call(0);
    expect(c.method).toBe("DELETE");
    expect(c.url.searchParams.get("sendUpdates")).toBe("all");
  });
});
