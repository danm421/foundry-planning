import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceImpersonationError } from "@/lib/workspace/errors";
import type { WorkspaceEvent } from "@/lib/workspace/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listActingConnections: vi.fn(),
  readWeek: vi.fn(),
  findHouseholdsByEmail: vi.fn(),
  linkEventHousehold: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/acting-connection", () => ({ listActingConnections: mocks.listActingConnections }));
vi.mock("@/lib/workspace/readers", () => ({ readWeek: mocks.readWeek }));
vi.mock("@/lib/workspace/client-links", () => ({
  findHouseholdsByEmail: mocks.findHouseholdsByEmail,
  linkEventHousehold: mocks.linkEventHousehold,
}));

import { GET } from "./route";

const MS = { id: "conn_ms", provider: "microsoft", status: "connected" };
const GOOGLE = { id: "conn_g", provider: "google", status: "connected" };

function ev(id: string, emails: string[], over: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  return {
    id,
    subject: "Meeting",
    start: "2026-11-02T09:00",
    end: "2026-11-02T10:00",
    isAllDay: false,
    isOrganizer: true,
    isCancelled: false,
    type: "singleInstance",
    attendees: emails.map((email) => ({ email, name: null })),
    meetingUrl: null,
    iCalUid: null,
    webLink: "",
    ...over,
  };
}

function week(over: Record<string, unknown> = {}) {
  return { timeZone: "America/Chicago", timeZoneFallback: false, events: [], accounts: [], ...over };
}

function get(start?: string, hidden?: string) {
  const query = [start ? `start=${start}` : null, hidden !== undefined ? `hidden=${hidden}` : null].filter(Boolean);
  return GET(new Request(`https://app.test/api/workspace/events${query.length ? `?${query.join("&")}` : ""}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.listActingConnections.mockResolvedValue([MS]);
  mocks.readWeek.mockResolvedValue(week());
  mocks.findHouseholdsByEmail.mockResolvedValue(new Map());
  mocks.linkEventHousehold.mockReturnValue(null);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/workspace/events", () => {
  it("reads the week across every account: key, connectionId, editable and household per event, and each account's error", async () => {
    const link = { householdId: "h1", householdName: "Smith" };
    mocks.listActingConnections.mockResolvedValue([MS, GOOGLE]);
    mocks.readWeek.mockResolvedValue(
      week({
        events: [
          { ...ev("a", ["x@c.com"]), connectionId: "conn_ms", provider: "microsoft" },
          { ...ev("b", ["y@c.com", "z@c.com"], { isOrganizer: false }), connectionId: "conn_g", provider: "google" },
        ],
        accounts: [
          { connectionId: "conn_ms", error: null },
          { connectionId: "conn_g", error: "throttled" },
        ],
      }),
    );
    mocks.linkEventHousehold.mockImplementation((e: { id: string }) => (e.id === "a" ? link : null));

    const res = await get("2026-11-02");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeZone).toBe("America/Chicago");
    expect(body.timeZoneFallback).toBe(false);
    expect(body.accounts).toEqual([
      { connectionId: "conn_ms", error: null },
      { connectionId: "conn_g", error: "throttled" },
    ]);
    expect(
      body.events.map((e: { key: string; connectionId: string; provider: string; editable: boolean; household: unknown }) => [
        e.key,
        e.connectionId,
        e.provider,
        e.editable,
        e.household,
      ]),
    ).toEqual([
      ["conn_ms:a", "conn_ms", "microsoft", true, link],
      ["conn_g:b", "conn_g", "google", false, null],
    ]);

    expect(mocks.readWeek).toHaveBeenCalledWith({
      connections: [MS, GOOGLE],
      hidden: new Set(),
      startDate: "2026-11-02",
      days: 7,
    });
    expect(mocks.listActingConnections).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada" });
    expect(mocks.findHouseholdsByEmail).toHaveBeenCalledTimes(1);
    expect(mocks.findHouseholdsByEmail).toHaveBeenCalledWith({
      firmId: "org_1",
      userId: "user_ada",
      orgRole: "org:member",
      emails: ["x@c.com", "y@c.com", "z@c.com"],
    });
  });

  it("(I1) hands the hidden ids to the readers, which read only the caller's own connections", async () => {
    mocks.listActingConnections.mockResolvedValue([MS, GOOGLE]);
    await get("2026-11-02", "conn_g,someone-elses-id,");
    expect(mocks.readWeek).toHaveBeenCalledWith(
      expect.objectContaining({ connections: [MS, GOOGLE], hidden: new Set(["conn_g", "someone-elses-id"]) }),
    );
    // The list comes from the session alone; the query can't add to it.
    expect(mocks.listActingConnections).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada" });
  });

  it("a cancelled meeting is never editable, even for its organizer", async () => {
    mocks.readWeek.mockResolvedValue(
      week({ events: [{ ...ev("c", [], { isCancelled: true }), connectionId: "conn_ms", provider: "microsoft" }] }),
    );
    const body = await (await get("2026-11-02")).json();
    expect(body.events[0].editable).toBe(false);
  });

  it("passes the readers' fallback zone through", async () => {
    mocks.readWeek.mockResolvedValue(week({ timeZone: "UTC", timeZoneFallback: true }));
    const body = await (await get("2026-11-02")).json();
    expect(body).toMatchObject({ timeZone: "UTC", timeZoneFallback: true });
  });

  it("no connected accounts → 409 connect, and nothing is read", async () => {
    mocks.listActingConnections.mockResolvedValue([]);
    const res = await get("2026-11-02");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "connect" });
    expect(mocks.readWeek).not.toHaveBeenCalled();
  });

  it("(Review Focus 5) an impersonation session → 403 impersonating, and nothing is read", async () => {
    mocks.listActingConnections.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await get("2026-11-02");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.readWeek).not.toHaveBeenCalled();
    expect(mocks.findHouseholdsByEmail).not.toHaveBeenCalled();
  });

  it.each([[undefined], ["2026-10-28"], ["2026-11-03"], ["nope"], ["2026-02-30"], ["2026-11-02T00:00"]])(
    "is 400 for start=%s",
    async (start) => {
      const res = await get(start);
      expect(res.status).toBe(400);
      expect(mocks.listActingConnections).not.toHaveBeenCalled();
    },
  );

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await get("2026-11-02");
    expect(res.status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
