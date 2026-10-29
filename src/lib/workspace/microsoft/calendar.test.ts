// src/lib/workspace/microsoft/calendar.test.ts
import { describe, it, expect, vi } from "vitest";
import type { WorkspaceConnection } from "../connections";
import type { WorkspaceEvent } from "../types";
import type { GraphContext } from "./graph";
import {
  canEditEvent,
  cancelEvent,
  createEvent,
  getEventForEdit,
  getMailboxTimeZone,
  listEvents,
  moveEvent,
} from "./calendar";

vi.mock("../connections", () => ({
  storeRefreshedTokens: vi.fn(),
  markNeedsReconnect: vi.fn(),
}));

const conn: WorkspaceConnection = {
  id: "conn-1",
  firmId: "firm-1",
  userId: "user-1",
  provider: "microsoft",
  tenantId: "tenant-1",
  externalUserId: "oid-1",
  externalEmail: "advisor@firm.test",
  accessToken: "AT",
  refreshToken: "RT",
  tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  scope: "Calendars.ReadWrite",
  status: "connected",
  lastError: null,
};

function json(body?: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function setup(...responses: Response[]) {
  const fetchImpl = vi.fn();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const ctx: GraphContext = { conn, fetchImpl: fetchImpl as unknown as typeof fetch };
  const call = (i: number) => {
    const [url, init] = fetchImpl.mock.calls[i] as [string, RequestInit];
    return {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
  };
  return { ctx, fetchImpl, call };
}

function graphEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    subject: "Review",
    start: { dateTime: "2026-11-02T09:00:00.0000000", timeZone: "Eastern Standard Time" },
    end: { dateTime: "2026-11-02T10:00:00.0000000", timeZone: "Eastern Standard Time" },
    isAllDay: false,
    isOrganizer: true,
    isCancelled: false,
    type: "singleInstance",
    attendees: [{ emailAddress: { address: "c@x.test", name: "Client" } }],
    iCalUId: "ABC",
    onlineMeeting: { joinUrl: "https://teams.test/j" },
    webLink: "https://outlook.test/e1",
    ...overrides,
  };
}

describe("getMailboxTimeZone", () => {
  it("returns the mailbox setting's value", async () => {
    const { ctx, call } = setup(json({ value: "Eastern Standard Time" }));
    await expect(getMailboxTimeZone(ctx)).resolves.toBe("Eastern Standard Time");
    expect(call(0).url).toBe("https://graph.microsoft.com/v1.0/me/mailboxSettings/timeZone");
  });

  it("falls back to UTC for a mailbox that has no time zone yet (Graph answers 204)", async () => {
    const { ctx } = setup(json(undefined, 204));
    await expect(getMailboxTimeZone(ctx)).resolves.toBe("UTC");
  });
});

describe("listEvents", () => {
  it("asks for the week by calendar date in the given time zone", async () => {
    const { ctx, call } = setup(json({ value: [] }));
    await listEvents(ctx, { startDate: "2026-10-26", days: 7, timeZone: "Eastern Standard Time" });

    const sent = call(0);
    const url = new URL(sent.url);
    expect(url.pathname).toBe("/v1.0/me/calendarView");
    expect(url.searchParams.get("startDateTime")).toBe("2026-10-25T00:00:00");
    expect(url.searchParams.get("endDateTime")).toBe("2026-11-03T00:00:00");
    expect(url.searchParams.get("$top")).toBe("250");
    expect(url.searchParams.get("$select")).toContain("onlineMeeting");
    expect(sent.headers.get("prefer")).toBe('outlook.timezone="Eastern Standard Time"');
  });

  it("follows nextLink and returns both pages", async () => {
    const { ctx, call } = setup(
      json({
        value: [graphEvent({ id: "a" })],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=1",
      }),
      json({ value: [graphEvent({ id: "b" })] }),
    );
    const events = await listEvents(ctx, { startDate: "2026-11-02", days: 1, timeZone: "UTC" });

    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(call(1).url).toBe("https://graph.microsoft.com/v1.0/me/calendarView?$skip=1");
  });

  it("maps a Graph event to wall-clock minutes", async () => {
    const { ctx } = setup(json({ value: [graphEvent()] }));
    const [e] = await listEvents(ctx, { startDate: "2026-11-02", days: 1, timeZone: "UTC" });

    expect(e).toEqual({
      id: "e1",
      subject: "Review",
      start: "2026-11-02T09:00",
      end: "2026-11-02T10:00",
      isAllDay: false,
      isOrganizer: true,
      isCancelled: false,
      type: "singleInstance",
      attendees: [{ email: "c@x.test", name: "Client" }],
      meetingUrl: "https://teams.test/j",
      iCalUid: "ABC",
      webLink: "https://outlook.test/e1",
    });
  });

  it("tolerates a null subject, missing meeting and unnamed attendees", async () => {
    const { ctx } = setup(
      json({
        value: [
          graphEvent({
            subject: null,
            onlineMeeting: null,
            attendees: [{ emailAddress: { address: "n@x.test", name: "" } }, { emailAddress: {} }],
          }),
        ],
      }),
    );
    const [e] = await listEvents(ctx, { startDate: "2026-11-02", days: 1, timeZone: "UTC" });
    expect(e.subject).toBe("");
    expect(e.meetingUrl).toBeNull();
    expect(e.attendees).toEqual([{ email: "n@x.test", name: null }]);
  });

  it("keeps only events overlapping the local week (calendarView bounds are read as UTC)", async () => {
    const at = (id: string, start: string, end: string, extra = {}) =>
      graphEvent({
        id,
        start: { dateTime: `${start}:00.0000000` },
        end: { dateTime: `${end}:00.0000000` },
        ...extra,
      });
    const { ctx } = setup(
      json({
        value: [
          at("before", "2026-10-25T21:00", "2026-10-25T22:00"),
          at("after", "2026-11-02T08:00", "2026-11-02T09:00"),
          at("lastEvening", "2026-11-01T22:00", "2026-11-01T23:00"),
          at("crossesIn", "2026-10-25T23:00", "2026-10-26T01:00"),
          at("allDay", "2026-11-01T00:00", "2026-11-02T00:00", { isAllDay: true }),
        ],
      }),
    );
    const events = await listEvents(ctx, { startDate: "2026-10-26", days: 7, timeZone: "Eastern Standard Time" });
    expect(events.map((e) => e.id)).toEqual(["lastEvening", "crossesIn", "allDay"]);
  });

  it("omits cancelled events", async () => {
    const { ctx } = setup(json({ value: [graphEvent({ id: "x", isCancelled: true }), graphEvent({ id: "y" })] }));
    const events = await listEvents(ctx, { startDate: "2026-11-02", days: 1, timeZone: "UTC" });
    expect(events.map((e) => e.id)).toEqual(["y"]);
  });
});

describe("canEditEvent", () => {
  const base = { isOrganizer: true, isCancelled: false } as WorkspaceEvent;
  it("is true only for a live event the advisor organizes", () => {
    expect(canEditEvent(base)).toBe(true);
    expect(canEditEvent({ ...base, isOrganizer: false })).toBe(false);
    expect(canEditEvent({ ...base, isCancelled: true })).toBe(false);
  });
});

describe("getEventForEdit", () => {
  it("reports organizer and whether there are attendees", async () => {
    const { ctx, call } = setup(json({ isOrganizer: true, attendees: [{}] }));
    await expect(getEventForEdit(ctx, "AAMk/abc=")).resolves.toEqual({ isOrganizer: true, hasAttendees: true });
    expect(call(0).url).toContain("/me/events/AAMk%2Fabc%3D?");
  });
});

describe("createEvent", () => {
  const input = {
    subject: "Meet",
    start: "2026-10-28T14:00",
    end: "2026-10-28T15:00",
    attendees: ["c@x.test"],
    teams: true,
    timeZone: "Eastern Standard Time",
  };

  it("requests Teams when the calendar allows teamsForBusiness", async () => {
    const { ctx, call } = setup(json({ allowedOnlineMeetingProviders: ["teamsForBusiness"] }), json(graphEvent(), 201));
    const out = await createEvent(ctx, input);

    expect(out.teamsFailed).toBe(false);
    expect(call(0).url).toContain("allowedOnlineMeetingProviders");
    const post = call(1);
    expect(post.method).toBe("POST");
    expect(post.body.isOnlineMeeting).toBe(true);
    expect(post.body.onlineMeetingProvider).toBe("teamsForBusiness");
    expect(post.body.start).toEqual({ dateTime: "2026-10-28T14:00:00", timeZone: "Eastern Standard Time" });
    expect(post.body.attendees).toEqual([{ emailAddress: { address: "c@x.test" }, type: "required" }]);
    expect(post.headers.get("prefer")).toBe('outlook.timezone="Eastern Standard Time"');
    expect(out.event.id).toBe("e1");
  });

  it("creates without Teams and flags it when the provider is not allowed", async () => {
    const { ctx, call } = setup(json({ allowedOnlineMeetingProviders: ["unknown"] }), json(graphEvent(), 201));
    const out = await createEvent(ctx, input);

    expect(out.teamsFailed).toBe(true);
    expect(call(1).body).not.toHaveProperty("isOnlineMeeting");
    expect(call(1).body).not.toHaveProperty("onlineMeetingProvider");
  });

  it("does not look up providers when Teams is not requested", async () => {
    const { ctx, fetchImpl } = setup(json(graphEvent(), 201));
    const out = await createEvent(ctx, { ...input, teams: false });

    expect(out.teamsFailed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("moveEvent", () => {
  it("PATCHes the encoded id with new wall-clock times", async () => {
    const { ctx, call } = setup(json(graphEvent()));
    await moveEvent(ctx, "AAMk/abc=", {
      start: "2026-10-28T14:00",
      end: "2026-10-28T15:00",
      timeZone: "Eastern Standard Time",
    });

    const sent = call(0);
    expect(sent.method).toBe("PATCH");
    expect(sent.url).toBe("https://graph.microsoft.com/v1.0/me/events/AAMk%2Fabc%3D");
    expect(sent.body.start.dateTime).toBe("2026-10-28T14:00:00");
    expect(sent.body.end).toEqual({ dateTime: "2026-10-28T15:00:00", timeZone: "Eastern Standard Time" });
  });
});

describe("cancelEvent", () => {
  it("cancels (notifying attendees) when there are attendees", async () => {
    const { ctx, call } = setup(json(undefined, 202));
    await cancelEvent(ctx, "AAMk/abc=", { hasAttendees: true });

    const sent = call(0);
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("https://graph.microsoft.com/v1.0/me/events/AAMk%2Fabc%3D/cancel");
    expect(sent.body).toEqual({ comment: "" });
  });

  it("deletes when there are no attendees", async () => {
    const { ctx, call } = setup(json(undefined, 204));
    await cancelEvent(ctx, "AAMk/abc=", { hasAttendees: false });

    expect(call(0).method).toBe("DELETE");
    expect(call(0).url).toBe("https://graph.microsoft.com/v1.0/me/events/AAMk%2Fabc%3D");
  });
});
