// src/lib/workspace/microsoft/adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import type { WorkspaceConnection } from "../connections";
import { microsoftAdapter } from "./adapter";

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
  connectedAt: new Date("2026-01-01T00:00:00Z"),
};

const json = (body?: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

/** The adapter builds its own GraphContext, so Graph is stubbed at global fetch. */
function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchMock);
  return (i: number) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return {
      url,
      headers: new Headers(init.headers),
      signal: init.signal,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
  };
}

const graphEvent = {
  id: "e1",
  subject: "Meet",
  start: { dateTime: "2026-11-02T09:00:00.0000000" },
  end: { dateTime: "2026-11-02T10:00:00.0000000" },
  isAllDay: false,
  isOrganizer: true,
  isCancelled: false,
  type: "singleInstance",
  attendees: [],
  webLink: "https://outlook.test/e1",
};

describe("microsoftAdapter", () => {
  it("asks Graph for the Windows name of the IANA zone", async () => {
    const call = stubFetch(json({ value: [] }));
    await microsoftAdapter.listEvents(conn, { startDate: "2026-11-02", days: 7, timeZone: "America/Chicago" });
    expect(call(0).headers.get("prefer")).toBe('outlook.timezone="Central Standard Time"');
  });

  it("hands a read's signal to Graph", async () => {
    const call = stubFetch(json({ value: [] }));
    const signal = new AbortController().signal;
    await microsoftAdapter.listEvents(conn, { startDate: "2026-11-02", days: 7, timeZone: "America/Chicago", signal });
    expect(call(0).signal).toBe(signal);
  });

  it("converts the zone on create and move too", async () => {
    const call = stubFetch(json(graphEvent, 201), json(graphEvent));
    const input = { start: "2026-11-02T09:00", end: "2026-11-02T10:00", timeZone: "America/Chicago" };
    await microsoftAdapter.createEvent(conn, { ...input, subject: "Meet", attendees: [], video: false });
    await microsoftAdapter.moveEvent(conn, "e1", input);
    expect(call(0).body.start.timeZone).toBe("Central Standard Time");
    expect(call(1).body.end.timeZone).toBe("Central Standard Time");
  });

  describe("getTimeZone", () => {
    it("maps the mailbox's Windows name to IANA", async () => {
      stubFetch(json({ value: "Central Standard Time" }));
      await expect(microsoftAdapter.getTimeZone(conn)).resolves.toBe("America/Chicago");
    });

    it("is null when the mailbox reports none (204)", async () => {
      stubFetch(json(undefined, 204));
      await expect(microsoftAdapter.getTimeZone(conn)).resolves.toBeNull();
    });

    it("is null for a custom zone that is not IANA", async () => {
      stubFetch(json({ value: "tzone://Microsoft/Custom" }));
      await expect(microsoftAdapter.getTimeZone(conn)).resolves.toBeNull();
    });
  });

  describe("createEvent video", () => {
    const input = {
      subject: "Meet",
      start: "2026-11-02T09:00",
      end: "2026-11-02T10:00",
      attendees: [],
      video: true,
      timeZone: "America/Chicago",
    };

    it("is not flagged failed when the calendar allows Teams", async () => {
      stubFetch(json({ allowedOnlineMeetingProviders: ["teamsForBusiness"] }), json(graphEvent, 201));
      const out = await microsoftAdapter.createEvent(conn, input);
      expect(out.videoFailed).toBe(false);
    });

    it("is flagged failed when the calendar allows none", async () => {
      stubFetch(json({ allowedOnlineMeetingProviders: [] }), json(graphEvent, 201));
      const out = await microsoftAdapter.createEvent(conn, input);
      expect(out.videoFailed).toBe(true);
    });
  });

  it("revoke resolves without calling Graph", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(microsoftAdapter.revoke(conn)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
